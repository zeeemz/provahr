// HR jobs list + role-intake entry point.
//
// Intake (PLAN §4 step 1): paste reference URLs, upload profile screenshots
// (FileReader → base64, ≤5 files, ≤2MB each, png/jpeg/webp — client-enforced,
// API-enforced again), free-text notes → POST /api/jobs/intake (201 + queued).
// The draft job then continues in the console (/app/jobs/:id).

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errMessage } from '../api/client';
import type { IntakeInput, IntakeResponse, IntakeScreenshot, Job } from '../api/types';
import { isRecruiterPlus, useAuth } from '../auth/AuthContext';
import { ApiErrorScreen, Spinner, fmtDate, humanize, statusBadgeClass } from '../components/ui';

const MAX_SCREENSHOTS = 5;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
const ALLOWED_MEDIA: IntakeScreenshot['mediaType'][] = ['image/png', 'image/jpeg', 'image/webp'];

export default function JobsPage(): JSX.Element {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ jobs: Job[] }>('/jobs')
      .then((res) => {
        if (!cancelled) {
          setJobs(res.jobs);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <main className="page">
      <h1>Roles</h1>
      <p className="sub">Intake a role from a reference person, or manage the pipeline of an existing one.</p>

      {error !== null && <ApiErrorScreen err={error} />}
      {error === null && jobs === null && <Spinner label="Loading roles…" />}

      {jobs !== null && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>JD</th>
                <th>Applications</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No roles yet — start one from a reference person below.
                  </td>
                </tr>
              )}
              {jobs.map((job) => (
                <tr key={job.id} className="clickable">
                  <td>
                    <Link to={`/app/jobs/${job.id}`}>
                      <strong>{job.title}</strong>
                    </Link>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {job.department} · {job.location} · {humanize(job.workMode)}
                    </div>
                  </td>
                  <td>
                    <span className={statusBadgeClass(job.status)}>{humanize(job.status)}</span>
                  </td>
                  <td>{job.jdStatus ? <span className="badge outline">{humanize(job.jdStatus)}</span> : <span className="muted">—</span>}</td>
                  <td>{job._count?.applications ?? 0}</td>
                  <td className="muted">{fmtDate(job.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isRecruiterPlus(user) ? (
        <IntakeForm onCreated={() => setReloadKey((k) => k + 1)} />
      ) : (
        <p className="hint">Role intake and publishing require the recruiter or admin role.</p>
      )}
    </main>
  );
}

function IntakeForm({ onCreated }: { onCreated: () => void }): JSX.Element {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [notes, setNotes] = useState('');
  const [urlsText, setUrlsText] = useState('');
  const [shots, setShots] = useState<IntakeScreenshot[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addFiles = useCallback((files: FileList | null): void => {
    if (files === null) return;
    setFileError(null);
    const incoming = Array.from(files);
    const next: IntakeScreenshot[] = [];
    for (const file of incoming) {
      if (!ALLOWED_MEDIA.includes(file.type as IntakeScreenshot['mediaType'])) {
        setFileError(`${file.name}: only PNG, JPEG or WebP screenshots are accepted.`);
        continue;
      }
      if (file.size > MAX_SCREENSHOT_BYTES) {
        setFileError(`${file.name}: larger than 2MB (skip it or compress it).`);
        continue;
      }
      next.push({
        name: file.name.slice(0, 120),
        mediaType: file.type as IntakeScreenshot['mediaType'],
        base64: '', // filled in by the FileReader below
      });
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.includes(',') ? result.split(',')[1]! : '';
        setShots((prev) =>
          prev.map((s) => (s.name === file.name.slice(0, 120) && s.base64 === '' ? { ...s, base64 } : s)),
        );
      };
      reader.onerror = () => {
        setFileError(`${file.name}: could not be read.`);
        setShots((prev) => prev.filter((s) => s.name !== file.name.slice(0, 120)));
      };
      reader.readAsDataURL(file);
    }
    setShots((prev) => [...prev, ...next].slice(0, MAX_SCREENSHOTS));
  }, []);

  const urls = urlsText
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean)
    .slice(0, 5);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitError(null);
    const hasMaterial = notes.trim() !== '' || urls.length > 0 || shots.length > 0;
    if (!hasMaterial) {
      setSubmitError('Give the AI something to work from: notes, URLs, or screenshots.');
      return;
    }
    if (shots.some((s) => s.base64 === '')) {
      setSubmitError('Screenshots are still reading — try again in a moment.');
      return;
    }
    const payload: IntakeInput = { urls, screenshots: shots };
    if (notes.trim() !== '') payload.notes = notes.trim();
    setBusy(true);
    try {
      const res = await api.post<IntakeResponse>('/jobs/intake', payload);
      onCreated();
      navigate(`/app/jobs/${res.job.id}`);
    } catch (err) {
      setSubmitError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>New role from a reference person</h2>
      <p className="sub">
        &ldquo;I want someone like ___&rdquo; — link their profiles, attach screenshots of a profile
        you admire, add notes. The AI drafts the JD; you edit and approve.
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <label className="field" htmlFor="in-urls">Reference URLs (up to 5, one per line)</label>
        <textarea
          id="in-urls"
          placeholder={'https://github.com/…\nhttps://their-blog.dev/'}
          value={urlsText}
          onChange={(e) => setUrlsText(e.target.value)}
        />
        <p className="hint">Public pages only (personal sites, GitHub, blogs). Best-effort enrichment — screenshots are the primary signal.</p>

        <label className="field" htmlFor="in-shots">Profile screenshots (up to 5, ≤2MB each)</label>
        <input
          id="in-shots"
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={(e) => addFiles(e.target.files)}
          style={{ padding: 6 }}
        />
        {shots.length > 0 && (
          <p className="hint">
            {shots.map((s) => (
              <span key={s.name} className="badge outline" style={{ marginRight: 6 }}>
                {s.name}
              </span>
            ))}
          </p>
        )}
        {fileError !== null && <p className="form-error">{fileError}</p>}

        <label className="field" htmlFor="in-notes">Notes — the person &amp; role in your words (optional)</label>
        <textarea
          id="in-notes"
          maxLength={4000}
          placeholder="e.g. Senior platform engineer, strong on reliability, has run on-call, mentors juniors…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {submitError !== null && <p className="form-error">{submitError}</p>}
        <p>
          <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create role & draft JD'}</button>
        </p>
        <p className="hint">
          Requires an active LLM provider (the API fails with <code>NO_PROVIDER</code> otherwise —
          configure one via <code>/api/admin/llm-providers</code>).
        </p>
      </form>
    </div>
  );
}

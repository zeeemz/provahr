// Public job detail + apply form — GET /api/public/jobs/:id, POST .../apply.
//
// The apply response carries the ONE-TIME test link token — the only time the
// plain token ever leaves the API (public.service.apply). The success screen
// treats it accordingly: prominent display, copy button, expiry, and a direct
// start link. There is no "resend" — losing it means contacting the employer.

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errMessage, isNotFound } from '../api/client';
import type { ApplyInput, ApplyResponse, PublicJob } from '../api/types';
import { ApiErrorScreen, Spinner, fmtDateTime, humanize } from '../components/ui';

interface FormState {
  name: string;
  email: string;
  phone: string;
  resumeUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  coverLetter: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  phone: '',
  resumeUrl: '',
  linkedinUrl: '',
  githubUrl: '',
  coverLetter: '',
};

export default function JobDetail(): JSX.Element {
  const { id = '' } = useParams();

  const [job, setJob] = useState<PublicJob | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ job: PublicJob }>(`/public/jobs/${id}`)
      .then((res) => {
        if (!cancelled) setJob(res.job);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loadError !== null) {
    return (
      <main className="page narrow">
        {isNotFound(loadError) ? (
          <div className="card">
            <h2>Role not found</h2>
            <p>This role is not open or does not exist.</p>
            <p>
              <Link to="/">Back to the board</Link>
            </p>
          </div>
        ) : (
          <ApiErrorScreen err={loadError} />
        )}
      </main>
    );
  }
  if (job === null) {
    return (
      <main className="page narrow">
        <Spinner />
      </main>
    );
  }

  return (
    <main className="page">
      <p>
        <Link to="/">← All open roles</Link>
      </p>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h1>{job.title}</h1>
          {job.testRequired ? (
            <span className="badge blue">Skill test required</span>
          ) : (
            <span className="badge outline">No skill test</span>
          )}
        </div>
        <p className="sub">
          {job.department} · {job.location} · {humanize(job.workMode)} ·{' '}
          {humanize(job.employmentType)}
          {(job.salaryMin !== null || job.salaryMax !== null) && (
            <>
              {' '}
              · {job.salaryCurrency ?? 'USD'}{' '}
              {job.salaryMin !== null ? job.salaryMin.toLocaleString() : '…'} –{' '}
              {job.salaryMax !== null ? job.salaryMax.toLocaleString() : '…'}
            </>
          )}
        </p>
        <h3>About the role</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{job.description}</p>
      </div>
      <ApplyForm jobId={job.id} testRequired={job.testRequired} />
    </main>
  );
}

function ApplyForm({ jobId, testRequired }: { jobId: string; testRequired: boolean }): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const testUrl = useMemo(
    () => (result?.testLink ? `${window.location.origin}/test/${result.testLink.token}` : ''),
    [result],
  );

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(testUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const payload: ApplyInput = {
      name: form.name.trim(),
      email: form.email.trim(),
    };
    if (form.phone.trim()) payload.phone = form.phone.trim();
    if (form.resumeUrl.trim()) payload.resumeUrl = form.resumeUrl.trim();
    if (form.linkedinUrl.trim()) payload.linkedinUrl = form.linkedinUrl.trim();
    if (form.githubUrl.trim()) payload.githubUrl = form.githubUrl.trim();
    if (form.coverLetter.trim()) payload.coverLetter = form.coverLetter.trim();
    try {
      const res = await api.post<ApplyResponse>(`/public/jobs/${jobId}/apply`, payload);
      setResult(res);
      window.scrollTo(0, 0);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <div className="card">
        <h2>Application received</h2>
        {result.testLink !== null ? (
          <>
            <p>
              This role includes a skill test. Your <strong>one-time test link</strong> is below —
              it is shown <strong>only this once</strong> and cannot be reissued, so save it now.
            </p>
            <div className="token-box">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>Test link (valid until {fmtDateTime(result.testLink.expiresAt)})</strong>
                <button type="button" className="small secondary" onClick={() => void copyLink()}>
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
              </div>
              <code>{testUrl}</code>
              <p className="hint">
                Single use · expires {fmtDateTime(result.testLink.expiresAt)}
                {result.testLink ? ' · the clock never pauses once you start' : ''}
              </p>
            </div>
            <p>
              <Link className="button" to={`/test/${result.testLink.token}`}>
                Start the test now
              </Link>
            </p>
            <p className="hint">
              Prefer to take it later? Copy the link above first — after leaving this page it cannot
              be recovered.
            </p>
          </>
        ) : (
          <p>
            Your application has been recorded. This role does not require a skill test{' '}
            {result.testLinkReason === 'NO_POOL' ? '(no active test)' : ''} — the hiring team will
            review and get back to you.
          </p>
        )}
      </div>
    );
  }

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="card">
      <h2>Apply{testRequired ? ' + take the skill test' : ''}</h2>
      {testRequired && (
        <p className="sub">
          Applying issues your one-time test link immediately. The test is monitored (tab-switch,
          paste, timing signals — no camera) and time-boxed.
        </p>
      )}
      <form onSubmit={(e) => void submit(e)}>
        <label className="field" htmlFor="ap-name">
          Full name
        </label>
        <input id="ap-name" type="text" required minLength={2} maxLength={120} value={form.name} onChange={set('name')} />

        <label className="field" htmlFor="ap-email">
          Email
        </label>
        <input id="ap-email" type="email" required maxLength={200} value={form.email} onChange={set('email')} />

        <label className="field" htmlFor="ap-phone">
          Phone (optional)
        </label>
        <input id="ap-phone" type="text" maxLength={30} value={form.phone} onChange={set('phone')} />

        <label className="field" htmlFor="ap-resume">
          Resume / portfolio URL (optional)
        </label>
        <input id="ap-resume" type="text" placeholder="https://…" value={form.resumeUrl} onChange={set('resumeUrl')} />

        <label className="field" htmlFor="ap-li">
          LinkedIn URL (optional)
        </label>
        <input id="ap-li" type="text" placeholder="https://linkedin.com/in/…" value={form.linkedinUrl} onChange={set('linkedinUrl')} />

        <label className="field" htmlFor="ap-gh">
          GitHub URL (optional)
        </label>
        <input id="ap-gh" type="text" placeholder="https://github.com/…" value={form.githubUrl} onChange={set('githubUrl')} />

        <label className="field" htmlFor="ap-cover">
          Why this role? (optional, max 5000 chars)
        </label>
        <textarea id="ap-cover" maxLength={5000} value={form.coverLetter} onChange={set('coverLetter')} />

        {error !== null && <p className="form-error">{error}</p>}
        <p>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </p>
        <p className="hint">No account needed. Applying to this role is one-time only.</p>
      </form>
    </div>
  );
}

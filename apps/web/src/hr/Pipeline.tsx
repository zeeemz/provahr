// Pipeline for one job — GET /api/jobs/:jobId/applications (any authed role).
// Row click → the application detail + X-ray.
//
// Walk-in (recruiter+, founder requirement 2026-09-20): a candidate arrives at
// the office → HR enters their identity → the application + one-time test link
// are minted → HR opens the test on the spot and hands over the keyboard; the
// candidate completes their own details at the start of the test.

import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errMessage } from '../api/client';
import type { ApplicationListItem, WalkInResponse } from '../api/types';
import { STAGES } from '../api/types';
import { isRecruiterPlus, useAuth } from '../auth/AuthContext';
import { ApiErrorScreen, Spinner, fmtDate, fmtDateTime, humanize, statusBadgeClass } from '../components/ui';

export default function Pipeline(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ApplicationListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stageFilter, setStageFilter] = useState('');
  const [walkInOpen, setWalkInOpen] = useState(false);

  const load = useCallback((): Promise<void> => {
    const qs = stageFilter ? `?stage=${stageFilter}` : '';
    return api
      .get<{ applications: ApplicationListItem[] }>(`/jobs/${id}/applications${qs}`)
      .then((res) => setRows(res.applications))
      .catch((err) => setError(err));
  }, [id, stageFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="page wide">
      <p>
        <Link to="/app/jobs">← All roles</Link>
      </p>
      <h1>Pipeline</h1>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="sub">Applications for this role, newest first.</p>
        <div className="row">
          {isRecruiterPlus(user) && !walkInOpen && (
            <button type="button" onClick={() => setWalkInOpen(true)}>
              + Walk-in candidate
            </button>
          )}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            style={{ width: 180 }}
            aria-label="Filter by stage"
          >
            <option value="">All stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {walkInOpen && (
        <WalkInCard
          jobId={id}
          onDone={() => {
            setWalkInOpen(false);
            void load(); // the new application appears immediately
          }}
          onCancel={() => setWalkInOpen(false)}
        />
      )}

      {error !== null && <ApiErrorScreen err={error} />}
      {error === null && rows === null && <Spinner label="Loading applications…" />}

      {rows !== null && (
        <div className="card" style={{ padding: 0 }}>
          <table className="list">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Stage</th>
                <th>Status</th>
                <th>Interviews</th>
                <th>Applied</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No applications{stageFilter ? ' at this stage' : ''} yet.
                  </td>
                </tr>
              )}
              {rows.map((app) => (
                <tr
                  key={app.id}
                  className="clickable"
                  onClick={() => navigate(`/app/applications/${app.id}`)}
                >
                  <td>
                    <Link to={`/app/applications/${app.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{app.candidate.name}</strong>
                    </Link>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {app.candidate.email} ·{' '}
                      <Link to={`/app/candidates/${app.candidateId}`} onClick={(e) => e.stopPropagation()}>
                        test profile →
                      </Link>
                    </div>
                  </td>
                  <td><span className="badge blue">{humanize(app.stage)}</span></td>
                  <td><span className={statusBadgeClass(app.status)}>{humanize(app.status)}</span></td>
                  <td className="muted">
                    {app.interviews.length === 0
                      ? '—'
                      : app.interviews.map((iv) => `${humanize(iv.type)} (${fmtDate(iv.scheduledAt)})`).join(', ')}
                  </td>
                  <td className="muted">{fmtDateTime(app.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

// ─── Walk-in: HR enters identity, then opens the test on the spot ─────────────

function WalkInCard({ jobId, onDone, onCancel }: { jobId: string; onDone: () => void; onCancel: () => void }): JSX.Element {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<WalkInResponse | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setFormError(null);
    const body: Record<string, string> = { name: name.trim(), email: email.trim() };
    if (phone.trim() !== '') body.phone = phone.trim();
    try {
      const res = await api.post<WalkInResponse>(`/jobs/${jobId}/walkin`, body);
      setResult(res);
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (result !== null) {
    const testUrl = result.testLink !== null ? `${window.location.origin}/test/${result.testLink.token}` : null;
    return (
      <div className="card">
        <h2>Walk-in ready — {name.trim()}</h2>
        {testUrl !== null ? (
          <>
            <p className="form-ok" style={{ marginTop: 0 }}>
              Application created and the one-time test link is minted.
            </p>
            <p className="sub">
              Hand the keyboard to the candidate now: they complete their own details, then take
              the test. The link is single-use and works on this machine or any other.
            </p>
            <div className="row">
              <a className="button" href={testUrl}>Open the test now →</a>
              <button type="button" className="secondary" onClick={() => void navigator.clipboard?.writeText(testUrl)}>
                Copy link
              </button>
              <button type="button" className="secondary" onClick={onDone}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="form-error" style={{ marginTop: 0 }}>
              Application created — but this role has no sealed question pool, so there is no test
              to run. Seal a pool on the role console first if a test is expected.
            </p>
            <p>
              <button type="button" className="secondary" onClick={onDone}>Done</button>
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Walk-in candidate</h2>
      <p className="sub">
        Enter who walked in — the application is created and a one-time test link is minted for
        them to take the test here and now. They fill in the rest of their details themselves
        before the test starts.
      </p>
      <label className="field" htmlFor="wi-name">Candidate full name</label>
      <input id="wi-name" type="text" required minLength={2} maxLength={120} value={name}
        onChange={(e) => setName(e.target.value)} />
      <label className="field" htmlFor="wi-email">Email</label>
      <input id="wi-email" type="email" required maxLength={200} value={email}
        onChange={(e) => setEmail(e.target.value)} />
      <label className="field" htmlFor="wi-phone">Phone (optional)</label>
      <input id="wi-phone" type="text" maxLength={30} value={phone}
        onChange={(e) => setPhone(e.target.value)} />
      {formError !== null && <p className="form-error">{formError}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" disabled={busy || name.trim().length < 2 || email.trim() === ''} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Create & mint test link'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

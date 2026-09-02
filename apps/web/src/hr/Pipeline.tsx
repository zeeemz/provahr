// Pipeline for one job — GET /api/jobs/:jobId/applications (any authed role).
// Row click → the application detail + X-ray.

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { ApplicationListItem } from '../api/types';
import { STAGES } from '../api/types';
import { ApiErrorScreen, Spinner, fmtDate, fmtDateTime, humanize, statusBadgeClass } from '../components/ui';

export default function Pipeline(): JSX.Element {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [rows, setRows] = useState<ApplicationListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stageFilter, setStageFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    const qs = stageFilter ? `?stage=${stageFilter}` : '';
    api
      .get<{ applications: ApplicationListItem[] }>(`/jobs/${id}/applications${qs}`)
      .then((res) => {
        if (!cancelled) setRows(res.applications);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [id, stageFilter]);

  return (
    <main className="page wide">
      <p>
        <Link to="/app/jobs">← All roles</Link>
      </p>
      <h1>Pipeline</h1>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="sub">Applications for this role, newest first.</p>
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
                    <div className="muted" style={{ fontSize: '0.82rem' }}>{app.candidate.email}</div>
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
      <p className="hint">
        TODO: the list view could show each candidate&apos;s test-session status inline (endpoint:
        <code> GET /api/applications/:id/xray</code> per row) — v1 links to the detail instead.
      </p>
    </main>
  );
}

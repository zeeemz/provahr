// Live background-work feed (founder ask 2026-09-20): what the async worker
// is doing right now — JD drafts, sample previews, pool seals, evaluations —
// with status, retries and the last recorded error. Polls while the page is
// open. Queue metadata only by construction: the API can't emit item content.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { ActivityEvent, ActivityView } from '../api/types';
import { ErrorBox, Spinner, fmtDateTime, humanize } from '../components/ui';

const POLL_MS = 3000;

const TYPE_LABELS: Record<ActivityEvent['type'], string> = {
  JD_GENERATION: 'JD draft',
  SAMPLES_GENERATION: 'Sample questions',
  POOL_SEAL: 'Pool seal',
  EVALUATION: 'Evaluation',
};

function queueStatusBadge(status: ActivityEvent['status']): string {
  switch (status) {
    case 'DONE':
      return 'badge green';
    case 'RUNNING':
      return 'badge blue';
    case 'FAILED':
      return 'badge red';
    case 'CANCELLED':
      return 'badge amber';
    default:
      return 'badge outline'; // PENDING — waiting for the worker
  }
}

export default function Activity(): JSX.Element {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<ActivityView>('/activity?limit=100');
      setEvents(res.events);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const inFlight = events?.filter((e) => e.status === 'RUNNING' || e.status === 'PENDING') ?? [];

  return (
    <main className="page wide">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>Activity</h1>
        {inFlight.length > 0 && (
          <span className="badge blue">
            <span className="spin" style={{ marginRight: 6 }} />
            {inFlight.length} in progress
          </span>
        )}
      </div>
      <p className="sub">
        Live log of background work for your company — AI generation the worker performs
        asynchronously. Updates every few seconds while this page is open.
      </p>

      {error !== null && <ErrorBox err={error} note="Could not load the activity feed" />}
      {error === null && events === null && <Spinner label="Loading activity…" />}
      {events !== null && events.length === 0 && (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No background work yet — it appears here the moment a JD draft, sample
            preview, pool seal or evaluation is queued.
          </p>
        </div>
      )}
      {events !== null && events.length > 0 && (
        <table className="list">
          <thead>
            <tr>
              <th>When</th>
              <th>Work</th>
              <th>Role</th>
              <th>Status</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.updatedAt)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {TYPE_LABELS[e.type] ?? humanize(e.type)}
                </td>
                <td>
                  {e.jobId !== null ? (
                    <Link to={`/app/jobs/${e.jobId}`}>{e.jobTitle ?? e.jobId}</Link>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <span className={queueStatusBadge(e.status)}>{humanize(e.status)}</span>
                  {e.status !== 'DONE' && e.attempts > 1 && (
                    <span className="muted" style={{ marginLeft: 6, fontSize: '0.8rem' }}>
                      try {e.attempts}/{e.maxAttempts}
                    </span>
                  )}
                </td>
                <td>
                  {e.lastError !== null ? (
                    <span className="form-error" style={{ margin: 0 }} title={e.lastError}>
                      {e.lastError.slice(0, 120)}
                      {e.lastError.length > 120 ? '…' : ''}
                    </span>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

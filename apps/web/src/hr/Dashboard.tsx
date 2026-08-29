// HR dashboard — GET /api/stats (stats.router is mounted at '/api/stats'; the
// route itself is '/', so the endpoint is /api/stats — NOT /api/stats/dashboard).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DashboardStats } from '../api/types';
import { STAGES } from '../api/types';
import { ApiErrorScreen, Spinner, fmtDateTime, humanize } from '../components/ui';

export default function Dashboard(): JSX.Element {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<DashboardStats>('/stats')
      .then((s) => {
        if (!cancelled) setStats(s);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error !== null) {
    return (
      <main className="page">
        <ApiErrorScreen err={error} />
      </main>
    );
  }
  if (stats === null) {
    return (
      <main className="page">
        <Spinner label="Loading dashboard…" />
      </main>
    );
  }

  const maxStage = Math.max(1, ...STAGES.map((s) => stats.byStage[s] ?? 0));

  return (
    <main className="page">
      <h1>Dashboard</h1>
      <p className="sub">Your hiring funnel at a glance.</p>

      <div className="grid cols3">
        <div className="card stat-tile">
          <div className="num">{stats.jobs.open}</div>
          <div className="lbl">Open roles (of {stats.jobs.total} total)</div>
        </div>
        <div className="card stat-tile">
          <div className="num">{stats.applications.active}</div>
          <div className="lbl">Active applications (of {stats.applications.total})</div>
        </div>
        <div className="card stat-tile">
          <div className="num">
            {stats.applications.hired}
            <span className="muted" style={{ fontSize: '1rem' }}> hired</span>
            {' / '}
            <span style={{ color: 'var(--danger)' }}>{stats.applications.rejected}</span>
            <span className="muted" style={{ fontSize: '1rem' }}> rejected</span>
          </div>
          <div className="lbl">Outcomes to date</div>
        </div>
      </div>

      <div className="card">
        <h2>Active pipeline by stage</h2>
        {STAGES.map((stage) => (
          <div key={stage} className="bar-row">
            <span className="stage-lbl">{humanize(stage)}</span>
            <div
              className="bar"
              style={{ width: `${((stats.byStage[stage] ?? 0) / maxStage) * 70}%` }}
              aria-hidden="true"
            />
            <span>{stats.byStage[stage] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="card">
        <h2>Recent activity</h2>
        {stats.recentEvents.length === 0 && <p className="muted mt0">No activity yet.</p>}
        {stats.recentEvents.map((event) => (
          <div key={event.id} style={{ borderBottom: '1px solid var(--border)', padding: '8px 0' }}>
            <strong>{event.application.candidate.name}</strong>{' '}
            <span className="muted">· {event.application.job.title}</span>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {event.actor ? `${event.actor.name} moved` : 'Moved'}{' '}
              {event.fromStage ? `${humanize(event.fromStage)} → ` : ''}
              {humanize(event.toStage)}
              {event.note ? ` — ${event.note}` : ''} · {fmtDateTime(event.createdAt)}
            </div>
          </div>
        ))}
      </div>

      <p className="hint">
        Next: <Link to="/app/jobs">manage roles</Link> or review a job&apos;s pipeline from its
        console page.
      </p>
    </main>
  );
}

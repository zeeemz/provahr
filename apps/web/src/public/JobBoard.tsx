// Public job board — GET /api/public/jobs (public.router).

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PublicJob } from '../api/types';
import { ApiErrorScreen, Spinner, humanize, WORK_MODES } from '../components/ui';

export default function JobBoard(): JSX.Element {
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const [workMode, setWorkMode] = useState('');

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (workMode) params.set('workMode', workMode);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    api
      .get<{ jobs: PublicJob[] }>(`/public/jobs${suffix}`)
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
  }, [q, workMode]);

  return (
    <main className="page">
      <h1>Open roles</h1>
      <p className="sub">
        Apply directly — no account needed. Roles with a skill test issue a one-time test link
        the moment you apply.
      </p>

      <div className="row" style={{ marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search title, department, location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 220 }}
          aria-label="Search jobs"
        />
        <select
          value={workMode}
          onChange={(e) => setWorkMode(e.target.value)}
          style={{ width: 160 }}
          aria-label="Filter by work mode"
        >
          <option value="">All work modes</option>
          {WORK_MODES.map((m) => (
            <option key={m} value={m}>
              {humanize(m)}
            </option>
          ))}
        </select>
      </div>

      {error !== null && <ApiErrorScreen err={error} />}
      {error === null && jobs === null && <Spinner label="Loading roles…" />}
      {jobs !== null && jobs.length === 0 && (
        <div className="card">
          <p className="mt0">No open roles match right now. Check back soon.</p>
        </div>
      )}

      <div className="grid cols2">
        {(jobs ?? []).map((job) => (
          <Link key={job.id} to={`/jobs/${job.id}`} className="card job-card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 className="mt0">{job.title}</h3>
              {job.testRequired ? (
                <span className="badge blue">Skill test</span>
              ) : (
                <span className="badge outline">No test</span>
              )}
            </div>
            <div className="meta">
              {job.department} · {job.location} · {humanize(job.workMode)} ·{' '}
              {humanize(job.employmentType)}
            </div>
            {(job.salaryMin !== null || job.salaryMax !== null) && (
              <div className="salary">
                {job.salaryCurrency ?? 'USD'}{' '}
                {job.salaryMin !== null ? job.salaryMin.toLocaleString() : '…'} –{' '}
                {job.salaryMax !== null ? job.salaryMax.toLocaleString() : '…'}
              </div>
            )}
            <p className="desc" style={{ marginBottom: 0 }}>
              {job.description.slice(0, 180)}
              {job.description.length > 180 ? '…' : ''}
            </p>
          </Link>
        ))}
      </div>

      {jobs !== null && (
        <p className="hint" style={{ marginTop: 12 }}>
          Hiring team? <Link to="/login">Sign in to the HR console</Link>.
        </p>
      )}
    </main>
  );
}

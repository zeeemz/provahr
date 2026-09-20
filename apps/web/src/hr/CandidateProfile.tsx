// Candidate test profile (founder requirement 2026-09-21): one person's
// testing story across this company's roles — applications, per-test
// outcomes, and the cross-session aggregate. The profile exists the moment a
// test completes (computed from evaluation evidence), and NOTHING here gates
// future applications: flunking one role never blocks another.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import type { CandidateProfileView } from '../api/types';
import {
  ApiErrorScreen,
  Spinner,
  fmtDate,
  fmtDateTime,
  humanize,
  statusBadgeClass,
} from '../components/ui';

const FORMAT_LABELS: Record<string, string> = {
  SWIPE_MCQ: 'Select-all',
  MCQ: 'Multiple choice',
  WRITTEN: 'Written',
  CODE: 'Coding',
};

export default function CandidateProfile(): JSX.Element {
  const { id = '' } = useParams();
  const [profile, setProfile] = useState<CandidateProfileView | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CandidateProfileView>(`/candidates/${id}/profile`)
      .then((res) => {
        if (!cancelled) setProfile(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error !== null) {
    return (
      <main className="page wide">
        <ApiErrorScreen err={error} />
      </main>
    );
  }
  if (profile === null) {
    return (
      <main className="page wide">
        <Spinner label="Loading candidate profile…" />
      </main>
    );
  }

  const { candidate, summary, history } = profile;
  const formats = Object.entries(summary.byFormat);

  return (
    <main className="page wide">
      <p>
        <Link to="/app/jobs">← All roles</Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{candidate.name}</h1>
        {summary.flags.high > 0 && (
          <span className="badge red">{summary.flags.high} HIGH AI-likelihood flag(s)</span>
        )}
      </div>
      <p className="sub">
        {candidate.email}
        {candidate.phone !== null && candidate.phone !== '' ? ` · ${candidate.phone}` : ''} · candidate
        since {fmtDate(candidate.createdAt)}
      </p>
      <p className="row" style={{ gap: 10 }}>
        {candidate.resumeUrl && (
          <a href={candidate.resumeUrl} target="_blank" rel="noreferrer">Resume ↗</a>
        )}
        {candidate.linkedinUrl && (
          <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn ↗</a>
        )}
        {candidate.githubUrl && (
          <a href={candidate.githubUrl} target="_blank" rel="noreferrer">GitHub ↗</a>
        )}
      </p>

      <div className="card">
        <h2>Test profile</h2>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>Applications</div>
            <strong style={{ fontSize: '1.3rem' }}>{summary.applications}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>Tests taken</div>
            <strong style={{ fontSize: '1.3rem' }}>{summary.testsTaken}</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.82rem' }}>Average score</div>
            <strong style={{ fontSize: '1.3rem' }}>
              {summary.averageScore === null ? '—' : summary.averageScore.toFixed(2)}
            </strong>
          </div>
          {summary.flags.medium > 0 && (
            <div>
              <div className="muted" style={{ fontSize: '0.82rem' }}>Flags</div>
              <strong style={{ fontSize: '1.3rem' }}>{summary.flags.medium} medium</strong>
            </div>
          )}
        </div>

        {formats.length > 0 && (
          <>
            <h3 style={{ marginBottom: 6 }}>By format (all tests combined)</h3>
            <table className="list">
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Correct</th>
                  <th>Partial</th>
                  <th>Incorrect</th>
                </tr>
              </thead>
              <tbody>
                {formats.map(([format, tally]) => (
                  <tr key={format}>
                    <td>{FORMAT_LABELS[format] ?? humanize(format)}</td>
                    <td><span className="badge green">{tally.CORRECT}</span></td>
                    <td><span className="badge amber">{tally.PARTIAL}</span></td>
                    <td><span className="badge red">{tally.INCORRECT}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
        {formats.length === 0 && summary.testsTaken === 0 && (
          <p className="muted" style={{ margin: 0 }}>
            No completed tests yet — the profile fills in as tests are submitted and evaluated.
          </p>
        )}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <h2 style={{ padding: '16px 16px 0' }}>Roles &amp; tests</h2>
        <table className="list">
          <thead>
            <tr>
              <th>Role</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Test</th>
              <th>Applied</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.applicationId}>
                <td>
                  <Link to={`/app/applications/${h.applicationId}`}><strong>{h.jobTitle}</strong></Link>
                  {h.source === 'WALK_IN' && (
                    <span className="badge outline" style={{ marginLeft: 8 }}>walk-in</span>
                  )}
                  {h.session?.strengths !== null && h.session !== null && (
                    <div className="muted" style={{ fontSize: '0.82rem' }}>
                      {h.session.strengths !== null && <>Strong: {h.session.strengths}</>}
                      {h.session.strengths !== null && h.session.gaps !== null && <> · </>}
                      {h.session.gaps !== null && <>Gaps: {h.session.gaps}</>}
                    </div>
                  )}
                </td>
                <td><span className="badge blue">{humanize(h.stage)}</span></td>
                <td><span className={statusBadgeClass(h.status)}>{humanize(h.status)}</span></td>
                <td>
                  {h.session === null && <span className="muted">—</span>}
                  {h.session !== null && h.session.score === null && (
                    <span className="muted">{humanize(h.session.status)}</span>
                  )}
                  {h.session !== null && h.session.score !== null && (
                    <strong>{h.session.score.toFixed(2)}</strong>
                  )}
                </td>
                <td className="muted">{fmtDateTime(h.appliedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">
        A result on one role never blocks this candidate from others — they can apply to any
        open role at any time.
      </p>
    </main>
  );
}

// Application detail + evaluation X-ray — the HR side of the asymmetric outcome.
//
//   GET   /api/applications/:id                candidate, history, interviews
//   GET   /api/applications/:id/xray           answers, verdicts, runs, signals
//   PATCH /api/applications/:id/stage          human pipeline move
//   POST  /api/applications/:id/status         reject (reason required) / withdraw / reopen
//   POST  /api/applications/admin/items/:id/void  (ADMIN) void a flawed item across sessions
//
// Flags never decide anything (PLAN §2.1): every move below is a human click.

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errMessage } from '../api/client';
import type {
  ApplicationDetail,
  Stage,
  SwipeValuation,
  Xray,
  XrayEvaluation,
  XrayExecution,
  XrayQuestion,
} from '../api/types';
import { asPresented, stageTransitionsFrom } from '../api/types';
import { isRecruiterPlus, useAuth } from '../auth/AuthContext';
import { ApiErrorScreen, Spinner, fmtDateTime, humanize, statusBadgeClass } from '../components/ui';

export default function ApplicationDetail(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [xray, setXray] = useState<Xray | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<XrayQuestion | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [detailRes, xrayRes] = await Promise.all([
        api.get<{ application: ApplicationDetail }>(`/applications/${id}`),
        api.get<{ xray: Xray }>(`/applications/${id}/xray`),
      ]);
      setApp(detailRes.application);
      setXray(xrayRes.xray);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error !== null) {
    return (
      <main className="page">
        <ApiErrorScreen err={error} />
      </main>
    );
  }
  if (app === null || xray === null) {
    return (
      <main className="page">
        <Spinner label="Loading application…" />
      </main>
    );
  }

  async function moveStage(stage: Stage): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await api.patch(`/applications/${id}/stage`, { stage });
      await load();
    } catch (err) {
      setActionError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(action: 'REJECT' | 'WITHDRAW' | 'REOPEN', reason?: string): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/applications/${id}/status`, { action, ...(reason !== undefined ? { reason } : {}) });
      setRejectOpen(false);
      await load();
    } catch (err) {
      setActionError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const canAct = isRecruiterPlus(user);
  const transitions = stageTransitionsFrom(app.stage);

  return (
    <main className="page wide">
      <p>
        <Link to={`/app/jobs/${app.job.id}/pipeline`}>← Pipeline: {app.job.title}</Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{app.candidate.name}</h1>
        <div className="row">
          <span className="badge blue">{humanize(app.stage)}</span>
          <span className={statusBadgeClass(app.status)}>{humanize(app.status)}</span>
        </div>
      </div>

      <div className="grid cols2">
        <div className="card">
          <h2>Candidate</h2>
          <dl className="kv">
            <dt>Email</dt>
            <dd>{app.candidate.email}</dd>
            <dt>Phone</dt>
            <dd>{app.candidate.phone || '—'}</dd>
            <dt>Links</dt>
            <dd>
              {app.candidate.resumeUrl ? (
                <>
                  <a href={app.candidate.resumeUrl} target="_blank" rel="noreferrer">resume</a>{' · '}
                </>
              ) : null}
              {app.candidate.linkedinUrl ? (
                <>
                  <a href={app.candidate.linkedinUrl} target="_blank" rel="noreferrer">linkedin</a>{' · '}
                </>
              ) : null}
              {app.candidate.githubUrl ? (
                <a href={app.candidate.githubUrl} target="_blank" rel="noreferrer">github</a>
              ) : null}
              {!app.candidate.resumeUrl && !app.candidate.linkedinUrl && !app.candidate.githubUrl ? '—' : ''}
            </dd>
            <dt>Applied</dt>
            <dd>{fmtDateTime(app.createdAt)}{app.source ? ` · via ${app.source}` : ''}</dd>
          </dl>
          {app.coverLetter ? (
            <>
              <h3>Cover letter</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{app.coverLetter}</p>
            </>
          ) : null}
          {app.rejectionReason ? (
            <p className="form-error">Rejection reason: {app.rejectionReason}</p>
          ) : null}
        </div>

        <div className="card">
          <h2>Pipeline actions{canAct ? '' : ' (read-only)'}</h2>
          {canAct ? (
            <>
              <p className="hint" style={{ marginTop: 0 }}>
                Stage moves follow the board rules; rejection is a status change and always needs a reason.
              </p>
              <div className="row">
                {transitions.length === 0 && <span className="muted">Hired — no further moves.</span>}
                {transitions.map((stage) => (
                  <button key={stage} type="button" className="secondary small" disabled={busy} onClick={() => void moveStage(stage)}>
                    → {humanize(stage)}
                  </button>
                ))}
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                {app.status === 'ACTIVE' && app.stage !== 'HIRED' && (
                  <button type="button" className="danger small" disabled={busy} onClick={() => setRejectOpen(true)}>
                    Reject…
                  </button>
                )}
                {app.status === 'ACTIVE' && (
                  <button type="button" className="secondary small" disabled={busy} onClick={() => void changeStatus('WITHDRAW')}>
                    Mark withdrawn
                  </button>
                )}
                {(app.status === 'REJECTED' || app.status === 'WITHDRAWN') && (
                  <button type="button" className="secondary small" disabled={busy} onClick={() => void changeStatus('REOPEN')}>
                    Reopen
                  </button>
                )}
              </div>
              {actionError !== null && <p className="form-error">{actionError}</p>}
            </>
          ) : (
            <p className="muted">Stage and status changes require the recruiter or admin role.</p>
          )}

          <h3 style={{ marginTop: 18 }}>History</h3>
          {app.stageEvents.map((event) => (
            <div key={event.id} className="muted" style={{ fontSize: '0.85rem', borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
              {event.actor ? `${event.actor.name}: ` : 'system: '}
              {event.fromStage ? `${humanize(event.fromStage)} → ` : ''}
              {humanize(event.toStage)}
              {event.note ? ` — ${event.note}` : ''} · {fmtDateTime(event.createdAt)}
            </div>
          ))}

          <h3 style={{ marginTop: 18 }}>Interviews</h3>
          {app.interviews.length === 0 && <p className="muted" style={{ fontSize: '0.88rem' }}>None scheduled.</p>}
          {app.interviews.map((iv) => (
            <div key={iv.id} style={{ fontSize: '0.88rem', borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
              <strong>{humanize(iv.type)}</strong> · {fmtDateTime(iv.scheduledAt)} · {humanize(iv.status)}
              {iv.interviewer ? ` · with ${iv.interviewer.name}` : ''}
              {iv.locationOrLink ? ` · ${iv.locationOrLink}` : ''}
              {iv.scorecards.length > 0 && (
                <span className="badge green" style={{ marginLeft: 6 }}>{iv.scorecards.length} scorecard(s)</span>
              )}
            </div>
          ))}
          <p className="hint">
            TODO: interview scheduling + scorecard entry from here (endpoints:{' '}
            <code>POST /api/applications/:id/interviews</code>,{' '}
            <code>PATCH /api/interviews/:id</code>) — list-only in v1.
          </p>
        </div>
      </div>

      <XrayPanel xray={xray} onVoid={(q) => setVoidTarget(q)} />

      {rejectOpen && (
        <RejectModal
          busy={busy}
          onCancel={() => setRejectOpen(false)}
          onSubmit={(reason) => void changeStatus('REJECT', reason)}
        />
      )}
      {voidTarget !== null && (
        <VoidModal
          question={voidTarget}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setVoidTarget(null)}
          onDone={async () => {
            setVoidTarget(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

// ─── X-ray ────────────────────────────────────────────────────────────────────

function XrayPanel({ xray, onVoid }: { xray: Xray; onVoid: (q: XrayQuestion) => void }): JSX.Element {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="card">
      <h2>Evaluation X-ray</h2>
      {!xray.available && (
        <p className="sub mt0">
          {xray.session === null
            ? 'No test session was issued for this application.'
            : `Test session is ${humanize(xray.session.status)} — the X-ray opens when it is submitted.`}
        </p>
      )}

      {xray.available && (
        <>
          <div className="row">
            <span className="badge">Session {humanize(xray.session?.status)}</span>
            <span className="badge outline">submitted {fmtDateTime(xray.session?.submittedAt)}</span>
            <span className="badge outline">{xray.signals.total} signal(s)</span>
          </div>

          {xray.assessment !== null && (
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
              <h3>Session assessment</h3>
              <dl className="kv">
                <dt>Total score (mean)</dt>
                <dd style={{ fontSize: '1.3rem', fontWeight: 700 }}>{xray.assessment.totalScore.toFixed(2)}</dd>
                {xray.assessment.strengths ? (
                  <>
                    <dt>Strengths</dt>
                    <dd>{xray.assessment.strengths}</dd>
                  </>
                ) : null}
                {xray.assessment.gaps ? (
                  <>
                    <dt>Gaps</dt>
                    <dd>{xray.assessment.gaps}</dd>
                  </>
                ) : null}
                {xray.assessment.recommendation ? (
                  <>
                    <dt>Recommendation (advisory)</dt>
                    <dd>{xray.assessment.recommendation}</dd>
                  </>
                ) : null}
              </dl>
              <Flags assessment={xray.assessment} signals={xray.signals} />
            </div>
          )}

          {xray.questions.map((q) => (
            <XrayQuestionCard key={q.order} question={q} isAdmin={isAdmin} onVoid={() => onVoid(q)} />
          ))}
        </>
      )}
    </div>
  );
}

function Flags({
  assessment,
  signals,
}: {
  assessment: NonNullable<Xray['assessment']>;
  signals: Xray['signals'];
}): JSX.Element {
  const flags = assessment.flagSummary ?? {};
  const aiHigh = flags.aiHigh ?? 0;
  const aiMedium = flags.aiMedium ?? 0;
  const entries = Object.entries(signals.byType);
  return (
    <div className="row" style={{ marginTop: 10 }}>
      {aiHigh > 0 && <span className="badge red">{aiHigh} HIGH AI-likelihood</span>}
      {aiMedium > 0 && <span className="badge amber">{aiMedium} MEDIUM AI-likelihood</span>}
      {(flags.collusion?.length ?? 0) > 0 && (
        <span className="badge red">Collusion flag ({flags.collusion!.length} partner session(s))</span>
      )}
      {(flags.unscoredItemIds?.length ?? 0) > 0 && (
        <span className="badge amber">{flags.unscoredItemIds!.length} unscored (pool drift / no provider)</span>
      )}
      {entries.map(([type, count]) => (
        <span key={type} className="badge outline">
          {humanize(type)} × {count}
        </span>
      ))}
      {aiHigh === 0 && aiMedium === 0 && entries.length === 0 && (
        <span className="muted" style={{ fontSize: '0.85rem' }}>No flags.</span>
      )}
    </div>
  );
}

function XrayQuestionCard({
  question,
  isAdmin,
  onVoid,
}: {
  question: XrayQuestion;
  isAdmin: boolean;
  onVoid: () => void;
}): JSX.Element {
  const presented = asPresented(question.presented);
  const evaln: XrayEvaluation | null = question.evaluation;
  const exec: XrayExecution | null = question.executionResult;
  const answer = question.answer;

  return (
    <div className="xray-q">
      <div className="head">
        <strong>Q{question.order}</strong>
        <span className="badge blue">{humanize(question.format)}</span>
        {evaln !== null && (
          <>
            <span className={`verdict-${evaln.verdict}`}>{evaln.verdict}</span>
            <span className="badge outline">score {evaln.score.toFixed(2)}</span>
            <span className={`badge ${evaln.aiLikelihood === 'HIGH' ? 'red' : evaln.aiLikelihood === 'MEDIUM' ? 'amber' : 'outline'}`}>
              AI: {evaln.aiLikelihood}
            </span>
            <span className="badge outline">{evaln.method}</span>
          </>
        )}
        {evaln === null && <span className="muted">(no evaluation — unscored)</span>}
        {evaln?.voided && <span className="badge red">VOIDED</span>}
        {isAdmin && evaln !== null && !evaln.voided && (
          <button type="button" className="small danger" style={{ marginLeft: 'auto' }} onClick={onVoid}>
            Void item…
          </button>
        )}
      </div>

      <p style={{ margin: '6px 0' }}>{presented.prompt}</p>

      {presented.options !== undefined && (
        <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
          {presented.options.map((o) => {
            const valuation = asSwipeValuation(answer?.content, o.id);
            const selected = asMcqChoice(answer?.content) === o.id;
            return (
              <li key={o.id}>
                {o.text}
                {valuation !== null && (
                  <span className={`badge ${valuation === 'LIKE' ? 'green' : 'red'}`} style={{ marginLeft: 8 }}>
                    {valuation === 'LIKE' ? 'liked' : 'disliked'}
                  </span>
                )}
                {selected && <span className="badge blue" style={{ marginLeft: 8 }}>selected</span>}
              </li>
            );
          })}
        </ul>
      )}

      {question.format === 'WRITTEN' && <AnswerText answer={answer?.content} />}
      {question.format === 'CODE' && (
        <>
          {presented.language !== undefined && <p className="hint">Language: <code>{presented.language}</code></p>}
          <AnswerText answer={answer?.content} code />
          {exec !== null && (
            <div style={{ marginTop: 8 }}>
              <h4 style={{ margin: '6px 0', fontSize: '0.85rem' }}>
                Sandbox run · exit {exec.exitCode} · {exec.durationMs}ms{exec.truncated ? ' · output truncated' : ''}
              </h4>
              {exec.caseResults !== null && exec.caseResults !== undefined && exec.caseResults.length > 0 && (
                <div className="row" style={{ marginBottom: 6 }}>
                  {exec.caseResults.map((c, i) => (
                    <span key={i} className={`badge ${c.passed === true ? 'green' : 'red'}`}>
                      {c.name ?? `case ${i + 1}`}
                    </span>
                  ))}
                </div>
              )}
              {exec.stdout !== '' && (
                <>
                  <div className="hint" style={{ marginTop: 6 }}>stdout</div>
                  <pre>{exec.stdout}</pre>
                </>
              )}
              {exec.stderr !== '' && (
                <>
                  <div className="hint" style={{ marginTop: 6 }}>stderr</div>
                  <pre>{exec.stderr}</pre>
                </>
              )}
            </div>
          )}
        </>
      )}

      {answer !== null && (
        <p className="hint" style={{ marginTop: 8 }}>
          {answer.revisions} revision(s) · first answered {fmtDateTime(answer.firstAnsweredAt)} · last{' '}
          {fmtDateTime(answer.lastAnsweredAt)}
        </p>
      )}

      {evaln?.qualityNotes ? (
        <p className="hint" style={{ marginTop: 4 }}><strong>Quality review:</strong> {evaln.qualityNotes}</p>
      ) : null}
      {evaln?.aiReasoning ? (
        <p className="hint" style={{ marginTop: 4 }}><strong>AI-likelihood reasoning:</strong> {evaln.aiReasoning}</p>
      ) : null}
    </div>
  );
}

function AnswerText({ answer, code }: { answer: unknown; code?: boolean }): JSX.Element {
  if (typeof answer === 'object' && answer !== null && 'text' in answer) {
    const t = (answer as { text: unknown }).text;
    if (typeof t === 'string') {
      return code ? <pre>{t}</pre> : <p style={{ whiteSpace: 'pre-wrap' }}>{t}</p>;
    }
  }
  return <p className="muted" style={{ fontStyle: 'italic' }}>No answer submitted.</p>;
}

function asSwipeValuation(answer: unknown, optionId: string): SwipeValuation | null {
  if (typeof answer === 'object' && answer !== null && optionId in answer) {
    const v = (answer as Record<string, unknown>)[optionId];
    if (v === 'LIKE' || v === 'DISLIKE') return v;
  }
  return null;
}

function asMcqChoice(answer: unknown): string | null {
  if (typeof answer === 'object' && answer !== null && 'optionId' in answer) {
    return String((answer as { optionId: unknown }).optionId);
  }
  return null;
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function RejectModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length >= 3;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Reject application">
      <div className="modal">
        <h2>Reject application</h2>
        <p className="sub">A reason is required (fair-hiring policy). The candidate profile is kept; nothing is automated.</p>
        <label className="field" htmlFor="rej-reason">Reason</label>
        <textarea
          id="rej-reason"
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Assessment below the bar for this role's seniority."
        />
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
          <button type="button" className="danger" disabled={!valid || busy} onClick={() => onSubmit(reason.trim())}>
            {busy ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VoidModal({
  question,
  busy,
  setBusy,
  onClose,
  onDone,
}: {
  question: XrayQuestion;
  busy: boolean;
  setBusy: (b: boolean) => void;
  onClose: () => void;
  onDone: () => Promise<void>;
}): JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/applications/admin/items/${question.itemId}/void`, { reason: reason.trim() });
      await onDone();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const valid = reason.trim().length >= 3;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Void question item">
      <div className="modal">
        <h2>Void this item across all sessions</h2>
        <p className="sub">
          Item <code>{question.itemId.slice(0, 13)}…</code> (Q{question.order}) will be excluded from
          every session&apos;s score and assessments re-normalized. This cannot be undone.
        </p>
        <label className="field" htmlFor="void-reason">Reason</label>
        <textarea
          id="void-reason"
          maxLength={1000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Flawed question — two options are both correct."
        />
        {error !== null && <p className="form-error">{error}</p>}
        <div className="row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="danger" disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Voiding…' : 'Void item'}
          </button>
        </div>
      </div>
    </div>
  );
}

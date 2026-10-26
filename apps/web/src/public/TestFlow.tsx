// Candidate test flow — consent → proctored session → "Submitted ✓".
//
// Endpoints (public.router / session.service):
//   GET  /api/public/test/:token          consent meta (never items)
//   POST /api/public/test/:token/start    draw + variants + clock (idempotent)
//   POST /api/public/test/:token/answers  { order, content } — autosaved
//   POST /api/public/test/:token/signals  batched proctoring evidence
//   POST /api/public/test/:token/submit   → { submitted: true } — nothing else
//
// DESIGN NOTES (mirroring PLAN.md §4 loop step 4):
// - The clock (meta.deadlineAt) never pauses; at zero we auto-submit inside
//   the API's 60s grace window so a candidate who is mid-typing still lands.
// - Signals are evidence only: TAB_SWITCH on visibilitychange, LARGE_PASTE on
//   >500-char pastes, COPY on copy events. They are batched client-side and
//   flushed every 10s + at submit; a failed flush is dropped, never blocking.
// - The submitted screen shows nothing but the confirmation (asymmetry is the
//   product). Scores/verdicts exist only in the HR X-ray.

import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, errMessage, isNotFound } from '../api/client';
import {
  asPresented,
  type AnswerContent,
  type CodeFileView,
  type CodeRunView,
  type MarkingView,
  type PresentedQuestion,
  type SessionView,
  type SignalType,
  type SwipeValuation,
  type TestLinkInfo,
} from '../api/types';
import { ApiErrorScreen, Spinner, fmtDateTime, mmss } from '../components/ui';

const PASTE_SIGNAL_THRESHOLD = 500; // chars — matches the product definition of a "large" paste
const SIGNAL_FLUSH_MS = 10_000; // batch flush cadence
const SIGNAL_BATCH_CAP = 100; // API schema max per batch
const TEXT_SAVE_DEBOUNCE_MS = 900;
const RUN_POLL_MS = 1_500; // IDE run polling cadence
const RUN_POLL_TIMEOUT_MS = 30_000; // give the queue + container ample time

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; err: unknown }
  | { kind: 'link-not-found' }
  | { kind: 'link-expired'; jobTitle?: string }
  | { kind: 'already-submitted'; jobTitle: string }
  | { kind: 'details'; info: TestLinkInfo } // walk-in: candidate completes their details pre-consent
  | { kind: 'consent'; info: TestLinkInfo }
  | { kind: 'resume'; info: TestLinkInfo }
  | { kind: 'starting' }
  | { kind: 'session' }
  | { kind: 'submitted' }
  | { kind: 'time-up' }; // deadline passed and submit fell outside the grace window

export default function TestFlow(): JSX.Element {
  const { token = '' } = useParams();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api
      .get<TestLinkInfo>(`/public/test/${token}`)
      .then((info) => {
        if (cancelled) return;
        if (info.status === 'EXPIRED') setPhase({ kind: 'link-expired', jobTitle: info.jobTitle });
        else if (info.status === 'SUBMITTED')
          setPhase({ kind: 'already-submitted', jobTitle: info.jobTitle });
        else if (info.status === 'STARTED') setPhase({ kind: 'resume', info });
        else if (info.walkIn) setPhase({ kind: 'details', info });
        else setPhase({ kind: 'consent', info });
      })
      .catch((err) => {
        if (cancelled) return;
        if (isNotFound(err)) setPhase({ kind: 'link-not-found' });
        else setPhase({ kind: 'error', err });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const beginSession = useCallback(async (): Promise<void> => {
    setPhase({ kind: 'starting' });
    try {
      await api.post<SessionView>(`/public/test/${token}/start`, {});
      setPhase({ kind: 'session' });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TEST_LINK_EXPIRED' || err.status === 410) {
          setPhase({ kind: 'link-expired' });
          return;
        }
        if (err.code === 'SESSION_SUBMITTED') {
          setPhase({ kind: 'already-submitted', jobTitle: '' });
          return;
        }
        if (err.code === 'SESSION_EXPIRED') {
          setPhase({ kind: 'time-up' });
          return;
        }
      }
      setPhase({ kind: 'error', err });
    }
  }, [token]);

  switch (phase.kind) {
    case 'loading':
      return shell(<Spinner label="Opening your test link…" />);
    case 'error':
      return shell(<ApiErrorScreen err={phase.err} />);
    case 'link-not-found':
      return shell(
        <div className="card">
          <h2>Test link not found</h2>
          <p>This link doesn&apos;t exist, was mistyped, or is malformed.</p>
          <p className="sub">
            Check that you copied the full link from your application confirmation.
          </p>
          <p>
            <Link to="/">Back to open roles</Link>
          </p>
        </div>,
      );
    case 'link-expired':
      return shell(
        <div className="card">
          <h2>Test link expired</h2>
          <p>
            This test link has expired{phase.jobTitle ? ` (${phase.jobTitle})` : ''}. Test links are
            time-boxed and single-use — contact the employer if you still want to be considered.
          </p>
          <p>
            <Link to="/">Back to open roles</Link>
          </p>
        </div>,
      );
    case 'already-submitted':
      return shell(
        <SubmittedCard
          note={phase.jobTitle ? `This test (${phase.jobTitle}) was already submitted. Nothing further is needed.` : 'This test was already submitted. Nothing further is needed.'}
          fetchMarkingFrom={token}
        />,
      );
    case 'details':
      return (
        <DetailsScreen
          token={token}
          info={phase.info}
          onContinue={() => setPhase({ kind: 'consent', info: phase.info })}
        />
      );
    case 'consent':
      return <ConsentScreen info={phase.info} onStart={() => void beginSession()} starting={false} />;
    case 'resume':
      return <ConsentScreen info={phase.info} onStart={() => void beginSession()} starting={false} resume />;
    case 'starting':
      return shell(<Spinner label="Drawing your questions…" />);
    case 'session':
      return <SessionRunner token={token} />;
    case 'submitted':
      return shell(
        <SubmittedCard
          marking={null}
          note="Your answers have been received. The hiring team will take it from here."
        />,
      );
    case 'time-up':
      return shell(
        <div className="card">
          <h2>Time is up</h2>
          <p>
            The clock never pauses. Your saved answers were submitted with the session; anything
            still unsaved when the clock hit zero was not.
          </p>
        </div>,
      );
  }
}

function shell(children: React.ReactNode): JSX.Element {
  return <main className="page narrow test-shell">{children}</main>;
}

// ─── Post-submit marking (founder decision 2026-09-21) ───────────────────────
// Objective formats (MCQ / select-all) are marked immediately; written and
// coding answers await evaluation by the hiring team.

function SubmittedCard({
  note,
  marking,
  fetchMarkingFrom,
}: {
  note: string;
  marking?: MarkingView | null;
  /** When set, the marking is fetched lazily (re-entry into a submitted link). */
  fetchMarkingFrom?: string;
}): JSX.Element {
  const [fetched, setFetched] = useState<MarkingView | null | undefined>(marking);
  useEffect(() => {
    if (fetchMarkingFrom === undefined || fetched !== undefined) return;
    let cancelled = false;
    api
      .get<MarkingView>(`/public/test/${fetchMarkingFrom}/marking`)
      .then((m) => {
        if (!cancelled) setFetched(m);
      })
      .catch(() => {
        if (!cancelled) setFetched(null); // best-effort — the plain confirmation stands
      });
    return () => {
      cancelled = true;
    };
  }, [fetchMarkingFrom, fetched]);

  return (
    <div className="card">
      <div className="submitted-hero">Submitted ✓</div>
      <p className="center sub">{note}</p>
      {fetched !== undefined && fetched !== null && <MarkingPanel marking={fetched} />}
    </div>
  );
}

function MarkingPanel({ marking }: { marking: MarkingView }): JSX.Element {
  const { summary, items } = marking;
  const pending = items.filter((i) => i.status === 'PENDING_EVALUATION').length;
  return (
    <div style={{ textAlign: 'left' }}>
      <h3 style={{ marginBottom: 6 }}>Your results so far</h3>
      <p className="sub" style={{ marginTop: 0 }}>
        Multiple-choice answers are marked automatically:{' '}
        <strong>
          {summary.correct} of {summary.marked} correct
        </strong>
        {summary.partial > 0 && <> · {summary.partial} partial</>}
        {pending > 0 && (
          <>
            {' '}· {pending} written/coding answer{pending === 1 ? '' : 's'} awaiting evaluation by
            the hiring team
          </>
        )}
        .
      </p>
      <table className="list" style={{ fontSize: '0.9rem' }}>
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.order}>
              <td>{item.order}</td>
              <td>{formatLabel(item.format)}</td>
              <td>
                {item.status === 'MARKED' && item.correct === true && (
                  <span className="badge green">Correct</span>
                )}
                {item.status === 'MARKED' && item.correct === false && (
                  <span className="badge red">
                    Incorrect{typeof item.score === 'number' && item.score > 0 ? ` (partial: ${item.score.toFixed(2)})` : ''}
                  </span>
                )}
                {item.status === 'PENDING_EVALUATION' && (
                  <span className="badge outline">Awaiting evaluation</span>
                )}
                {item.status === 'NOT_COUNTED' && <span className="badge outline">Not counted</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pending > 0 && (
        <p className="hint">
          Written and coding answers are reviewed by the hiring team — you&apos;ll hear from them.
        </p>
      )}
    </div>
  );
}

// ─── Walk-in details (candidate fills what HR could not) ─────────────────────

function DetailsScreen({
  token,
  info,
  onContinue,
}: {
  token: string;
  info: TestLinkInfo;
  onContinue: () => void;
}): JSX.Element {
  const c = info.candidate;
  const [phone, setPhone] = useState(c?.phone ?? '');
  const [resumeUrl, setResumeUrl] = useState(c?.resumeUrl ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(c?.linkedinUrl ?? '');
  const [githubUrl, setGithubUrl] = useState(c?.githubUrl ?? '');
  const [coverLetter, setCoverLetter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function continueToConsent(): Promise<void> {
    setBusy(true);
    setError(null);
    // Only filled fields are sent — everything here is optional by design.
    const body: Record<string, string> = {};
    if (phone.trim() !== '') body.phone = phone.trim();
    if (resumeUrl.trim() !== '') body.resumeUrl = resumeUrl.trim();
    if (linkedinUrl.trim() !== '') body.linkedinUrl = linkedinUrl.trim();
    if (githubUrl.trim() !== '') body.githubUrl = githubUrl.trim();
    if (coverLetter.trim() !== '') body.coverLetter = coverLetter.trim();
    try {
      if (Object.keys(body).length > 0) {
        await api.post(`/public/test/${token}/details`, body);
      }
      onContinue();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page narrow test-shell">
      <div className="card">
        <h1>{info.jobTitle}</h1>
        <p className="sub">Welcome{c ? `, ${c.name}` : ''} — a few details before your test.</p>

        {c !== undefined && (
          <p className="hint">
            Registered by the hiring team as <strong>{c.name}</strong> ({c.email}).
            Something wrong? Tell the person who checked you in.
          </p>
        )}

        <label className="field" htmlFor="wd-phone">Phone</label>
        <input id="wd-phone" type="text" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />

        <label className="field" htmlFor="wd-resume">Resume URL (optional)</label>
        <input id="wd-resume" type="text" placeholder="https://…" maxLength={500} value={resumeUrl}
          onChange={(e) => setResumeUrl(e.target.value)} />

        <label className="field" htmlFor="wd-li">LinkedIn (optional)</label>
        <input id="wd-li" type="text" placeholder="https://linkedin.com/in/…" maxLength={500} value={linkedinUrl}
          onChange={(e) => setLinkedinUrl(e.target.value)} />

        <label className="field" htmlFor="wd-gh">GitHub (optional)</label>
        <input id="wd-gh" type="text" placeholder="https://github.com/…" maxLength={500} value={githubUrl}
          onChange={(e) => setGithubUrl(e.target.value)} />

        <label className="field" htmlFor="wd-cover">Anything you'd like us to know? (optional)</label>
        <textarea id="wd-cover" maxLength={5000} style={{ minHeight: 100 }} value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)} />

        {error !== null && <p className="form-error">{error}</p>}
        <p style={{ marginTop: 16 }}>
          <button type="button" disabled={busy} onClick={() => void continueToConsent()}>
            {busy ? 'Saving…' : 'Continue'}
          </button>
        </p>
        <p className="hint">Everything here is optional — Continue works without filling anything in.</p>
      </div>
    </main>
  );
}

// ─── Consent ──────────────────────────────────────────────────────────────────

function ConsentScreen({
  info,
  onStart,
  starting,
  resume,
}: {
  info: TestLinkInfo;
  onStart: () => void;
  starting: boolean;
  resume?: boolean;
}): JSX.Element {
  const [agreed, setAgreed] = useState(false);

  return (
    <main className="page narrow test-shell">
      <div className="card">
        <h1>{info.jobTitle}</h1>
        <p className="sub">
          {resume ? 'Your test is in progress — the clock never paused.' : 'Skill test'} ·{' '}
          {info.timeLimitMin !== null ? `${info.timeLimitMin} minutes, one sitting` : 'Time-boxed, one sitting'}
        </p>

        {resume && (
          <p className="form-error">
            You already started this test. Re-entering does not stop or reset the clock.
          </p>
        )}

        <h3>Before you begin — what is monitored</h3>
        <ul className="consent-list">
          <li>Tab-switch detection (the test page notices when you leave it)</li>
          <li>Paste detection (very large pastes are recorded)</li>
          <li>Timing analysis (how long you take, per question and overall)</li>
          <li>
            <strong>No camera. No screen recording.</strong> Nothing visual is captured.
          </li>
        </ul>
        <p className="hint">
          These signals are fairness evidence for a human reviewer — they never decide anything on
          their own.
        </p>

        <h3>Rules of the session</h3>
        <ul className="consent-list">
          <li>One question at a time; you can go back to review while the clock runs</li>
          <li>The clock starts when you click below and never pauses — not on refresh, not on re-entry</li>
          <li>Your answers save automatically as you go</li>
          <li>This link is single-use: once submitted, it is done</li>
        </ul>

        <label className="row" style={{ marginTop: 16, fontWeight: 600, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <span style={{ fontWeight: 400 }}>
            I understand this test is monitored (tab-switch/paste/timing signals; no camera)
          </span>
        </label>

        <p style={{ marginTop: 18 }}>
          <button type="button" disabled={!agreed || starting} onClick={onStart}>
            {starting ? 'Starting…' : resume ? 'Re-enter the test' : 'Start the test'}
          </button>
        </p>
        <p className="hint">Link expires {fmtDateTime(info.expiresAt)} if never started.</p>
      </div>
    </main>
  );
}

// ─── Signal collection (batched, evidence-only) ───────────────────────────────

interface QueuedSignal {
  type: SignalType;
  at: string;
  detail?: Record<string, unknown>;
}

function useSignals(token: string, active: boolean): {
  push: (type: SignalType, detail?: Record<string, unknown>) => void;
  flush: () => Promise<void>;
} {
  const queueRef = useRef<QueuedSignal[]>([]);
  const activeRef = useRef(active);
  activeRef.current = active;

  const flush = useCallback(async (): Promise<void> => {
    const batch = queueRef.current.splice(0, SIGNAL_BATCH_CAP);
    if (batch.length === 0) return;
    try {
      await api.post(`/public/test/${token}/signals`, { signals: batch });
    } catch {
      /* Evidence only: a dropped batch never blocks or alerts the candidate. */
    }
  }, [token]);

  const push = useCallback((type: SignalType, detail?: Record<string, unknown>): void => {
    if (!activeRef.current) return;
    if (queueRef.current.length >= SIGNAL_BATCH_CAP) return; // client-side cap
    queueRef.current.push({ type, at: new Date().toISOString(), ...(detail ? { detail } : {}) });
  }, []);

  // Timer-driven batch flush every 10s while the session is active.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void flush(), SIGNAL_FLUSH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [active, flush]);

  // TAB_SWITCH on visibility change; COPY on copy events (same evidence family).
  useEffect(() => {
    if (!active) return;
    const onVisibility = (): void => {
      if (document.hidden) push('TAB_SWITCH', { url: window.location.pathname });
    };
    const onCopy = (): void => {
      push('COPY', { order: 'page' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('copy', onCopy);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('copy', onCopy);
    };
  }, [active, push]);

  return { push, flush };
}

// ─── The session ──────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function SessionRunner({ token }: { token: string }): JSX.Element {
  const [view, setView] = useState<SessionView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [index, setIndex] = useState(0); // 0-based position in questions order
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ended, setEnded] = useState<{ kind: 'submitted'; marking: MarkingView | null } | { kind: 'time-up' } | null>(null);

  const submittedRef = useRef(false); // guards the one-shot auto-submit at zero
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending debounced save (WRITTEN {text} or CODE {files, entry}).
  const lastPendingRef = useRef<{ order: number; content: AnswerContent } | null>(null);

  // IDE runs (CODE questions): the run being awaited, its output, and a
  // transient note (rate limit / cap / expired) keyed by question order.
  const [runsByOrder, setRunsByOrder] = useState<Record<number, CodeRunView[]>>({});
  const [runningOrder, setRunningOrder] = useState<number | null>(null);
  const [runNoteByOrder, setRunNoteByOrder] = useState<Record<number, string>>({});

  const signals = useSignals(token, ended === null);
  const sessionActive = ended === null;
  // Mirror for async loops (run polling) that must stop when the session ends.
  const sessionActiveRef = useRef(true);
  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  // Load / re-enter the session view (start already happened; this also heals
  // a page refresh because GET .../session is refresh-safe).
  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionView>(`/public/test/${token}/session`)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const deadline = view !== null ? new Date(view.meta.deadlineAt).getTime() : null;

  // The clock: 4 ticks/second for a smooth final minute.
  useEffect(() => {
    if (deadline === null || !sessionActive) return;
    const tick = (): void => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true; // exactly one attempt
        void finalize(true);
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadline, sessionActive]);

  const questions = view?.questions ?? [];
  const current = questions[index];
  const answers = view?.answers ?? {};

  // Answer POST wrapper:SESSION_EXPIRED means the clock won — attempt the
  // grace-window submit; anything else surfaces as a save error.
  const postAnswer = useCallback(
    async (order: number, content: AnswerContent): Promise<void> => {
      if (!sessionActive) return;
      setSaveState('saving');
      try {
        await api.post(`/public/test/${token}/answers`, { order, content });
        setSaveState('saved');
        setView((v) => (v === null ? v : { ...v, answers: { ...v.answers, [String(order)]: content } }));
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_SUBMITTED')) {
          if (!submittedRef.current) {
            submittedRef.current = true;
            void finalize(true);
          }
          return;
        }
        setSaveState('error');
      }
    },
    [token, sessionActive], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Debounced save for text-bearing formats (WRITTEN {text}, CODE {files}).
  const queueAnswerSave = useCallback(
    (order: number, content: AnswerContent): void => {
      lastPendingRef.current = { order, content };
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const last = lastPendingRef.current;
        if (last !== null) void postAnswer(last.order, last.content);
      }, TEXT_SAVE_DEBOUNCE_MS);
    },
    [postAnswer],
  );

  const queueTextSave = useCallback(
    (order: number, text: string): void => queueAnswerSave(order, { text }),
    [queueAnswerSave],
  );

  const queueCodeSave = useCallback(
    (order: number, files: CodeFileView[], entry: string): void =>
      queueAnswerSave(order, { files, entry }),
    [queueAnswerSave],
  );

  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    },
    [],
  );

  /** Flush any pending debounced save NOW (used before a Run and before
   *  submit — the server executes the SAVED answer, so the latest keystrokes
   *  must land first). */
  async function flushPendingAnswer(): Promise<void> {
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const last = lastPendingRef.current;
    if (last !== null && sessionActive) {
      lastPendingRef.current = null;
      await api
        .post(`/public/test/${token}/answers`, { order: last.order, content: last.content })
        .then(() => {
          setView((v) =>
            v === null ? v : { ...v, answers: { ...v.answers, [String(last.order)]: last.content } },
          );
        })
        .catch(() => undefined); // the run/submit surfaces real errors; this is best-effort
    }
  }

  /** IDE Run: flush the save, enqueue the run, poll until it settles. The
   *  output panel reads the run row — never hidden-case truth (runs carry
   *  only the candidate's own output). */
  async function runCode(order: number, args: string[]): Promise<void> {
    if (runningOrder !== null || !sessionActive) return;
    setRunNoteByOrder((n) => ({ ...n, [order]: '' }));
    setRunningOrder(order);
    try {
      await flushPendingAnswer();
      const res = await api.post<{ run: { id: string } }>(`/public/test/${token}/run`, { order, args });
      signals.push('CODE_RUN', { order }); // evidence of live iteration
      const runId = res.run.id;
      const startedAt = Date.now();
      // Poll until terminal, timeout, or session end.
      for (;;) {
        if (!sessionActiveRef.current) return;
        await new Promise((r) => setTimeout(r, RUN_POLL_MS));
        let list: CodeRunView[];
        try {
          list = (await api.get<{ runs: CodeRunView[] }>(`/public/test/${token}/runs?order=${order}`)).runs;
        } catch {
          continue; // transient poll failure — keep trying until timeout
        }
        setRunsByOrder((m) => ({ ...m, [order]: list }));
        const mine = list.find((r) => r.id === runId);
        if (mine !== undefined && mine.status !== 'QUEUED') return;
        if (Date.now() - startedAt > RUN_POLL_TIMEOUT_MS) {
          setRunNoteByOrder((n) => ({ ...n, [order]: 'Run is taking unusually long — try again shortly.' }));
          return;
        }
      }
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_SUBMITTED')) {
        if (!submittedRef.current) {
          submittedRef.current = true;
          void finalize(true);
        }
        return;
      }
      setRunNoteByOrder((n) => ({ ...n, [order]: errMessage(err) }));
    } finally {
      setRunningOrder(null);
    }
  }

  /** Submit (manual or clock-driven); flushes signals first. */
  async function finalize(auto: boolean): Promise<void> {
    // Flush the pending debounced text so the final keystrokes are included.
    await flushPendingAnswer();
    await signals.flush();
    setSubmitting(true);
    try {
      const res = await api.post<{ submitted: boolean; marking?: MarkingView }>(
        `/public/test/${token}/submit`,
        {},
      );
      setEnded({ kind: 'submitted', marking: res.marking ?? null });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
        // Outside the 60s grace window: the saved answers stand, unsaved tail lost.
        void auto;
        setEnded({ kind: 'time-up' });
        return;
      }
      setSaveState('error');
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (ended !== null && ended.kind === 'submitted') {
    return shell(
      <SubmittedCard
        marking={ended.marking}
        note={
          ended.marking === null
            ? 'Your answers have been received. The hiring team will take it from here.'
            : 'Your answers have been received.'
        }
      />,
    );
  }
  if (ended !== null && ended.kind === 'time-up') {
    return shell(
      <div className="card">
        <h2>Time is up</h2>
        <p>The clock never pauses. Everything you saved before zero was submitted with the session.</p>
      </div>,
    );
  }

  if (error !== null) {
    return shell(<ApiErrorScreen err={error} />);
  }
  if (view === null) {
    return shell(<Spinner label="Loading your questions…" />);
  }

  const danger = remainingMs !== null && remainingMs < 60_000;
  // CODE questions take over the viewport entirely: a full-bleed IDE shell
  // (dark chrome edge-to-edge, editor fills the height) instead of the exam
  // card layout. Every other format keeps the narrow exam shell.
  const isCodeQuestion = current?.format === 'CODE';

  const questionCard = current !== undefined ? (
    <QuestionCard
      key={current.order}
      order={current.order}
      format={current.format}
      presented={asPresented(current.presented)}
      saved={answers[String(current.order)]}
      postAnswer={(content) => void postAnswer(current.order, content)}
      queueTextSave={(text) => queueTextSave(current.order, text)}
      queueCodeSave={(files, entry) => queueCodeSave(current.order, files, entry)}
      pushSignal={signals.push}
      runs={runsByOrder[current.order] ?? []}
      running={runningOrder === current.order}
      runNote={runNoteByOrder[current.order] ?? ''}
      onRun={(args) => void runCode(current.order, args)}
      saveState={saveState}
    />
  ) : null;

  if (isCodeQuestion) {
    return (
      <main className="ide-page">
        <header className="ide-topbar">
          <div className="ide-topbar-side">
            <strong className="ide-brand">⬢ ProvaHR</strong>
            <span className="ide-topbar-sep" aria-hidden="true" />
            <span>
              Question {index + 1} of {questions.length}
            </span>
            <span className="badge blue" style={{ marginLeft: 10 }}>Coding task</span>
          </div>
          <div className="ide-topbar-side">
            {saveState === 'error' && <span className="ide-save-error">save failed — retry an edit</span>}
            <span className={`ide-timer${danger ? ' danger' : ''}`} aria-live="off">
              ⏱ {remainingMs !== null ? mmss(remainingMs) : '--:--'}
            </span>
            <button
              type="button"
              className="ide-nav"
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
              disabled={index === 0}
            >
              ← Prev
            </button>
            {index < questions.length - 1 ? (
              <button type="button" className="ide-nav" onClick={() => setIndex((i) => i + 1)}>
                Next →
              </button>
            ) : (
              <button
                type="button"
                className="ide-nav ide-nav-primary"
                onClick={() => void finalize(false)}
                disabled={submitting}
              >
                {submitting ? 'Submitting…' : 'Submit test'}
              </button>
            )}
          </div>
        </header>
        <div className="ide-progress" aria-hidden="true">
          <div style={{ width: `${((index + 1) / Math.max(1, questions.length)) * 100}%` }} />
        </div>
        <div className="ide-fill">{questionCard}</div>
      </main>
    );
  }

  return (
    <main className="page narrow test-shell">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <strong>
          Question {index + 1} of {questions.length}
        </strong>
        <span className={`timer${danger ? ' danger' : ''}`} aria-live="off">
          ⏱ {remainingMs !== null ? mmss(remainingMs) : '--:--'}
        </span>
      </div>
      <div className="progress" aria-hidden="true">
        <div style={{ width: `${((index + 1) / Math.max(1, questions.length)) * 100}%` }} />
      </div>
      <p className="save-state" style={{ minHeight: 18 }}>
        {saveState === 'saving' && 'Saving…'}
        {saveState === 'saved' && 'Saved ✓'}
        {saveState === 'error' && (
          <span style={{ color: 'var(--danger)' }}>Could not save the last change — try again.</span>
        )}
      </p>

      {questionCard}

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 18 }}>
        <button
          type="button"
          className="secondary"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          ← Previous
        </button>
        {index < questions.length - 1 ? (
          <button type="button" onClick={() => setIndex((i) => i + 1)}>
            Next →
          </button>
        ) : (
          <button type="button" onClick={() => void finalize(false)} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit test'}
          </button>
        )}
      </div>
      {index === questions.length - 1 && (
        <p className="hint">
          Submitting ends the session — you can still go back and revise first. You may also
          navigate back without submitting; the clock keeps running either way.
        </p>
      )}
      {saveState === 'error' && (
        <p className="form-error">Answer not saved — check your connection and re-apply your last change.</p>
      )}
    </main>
  );
}

// ─── Format-aware question rendering ─────────────────────────────────────────

function QuestionCard({
  order,
  format,
  presented,
  saved,
  postAnswer,
  queueTextSave,
  queueCodeSave,
  pushSignal,
  runs,
  running,
  runNote,
  onRun,
  saveState,
}: {
  order: number;
  format: string;
  presented: PresentedQuestion;
  saved: unknown;
  postAnswer: (content: AnswerContent) => void;
  queueTextSave: (text: string) => void;
  queueCodeSave: (files: CodeFileView[], entry: string) => void;
  pushSignal: (type: SignalType, detail?: Record<string, unknown>) => void;
  runs: CodeRunView[];
  running: boolean;
  runNote: string;
  onRun: (args: string[]) => void;
  saveState: SaveState;
}): JSX.Element {
  // LARGE_PASTE detection shared by every text-bearing format (chars-based:
  // the textarea reports its paste event, Monaco its pasted range).
  function reportLargePaste(chars: number): void {
    if (chars > PASTE_SIGNAL_THRESHOLD) {
      pushSignal('LARGE_PASTE', { chars, order });
    }
  }

  // CODE renders as its own IDE workspace — the prompt lives in the left
  // task panel, not above the editor. Every other format keeps the exam card.
  if (format === 'CODE') {
    return (
      <CodeBody
        order={order}
        prompt={presented.prompt}
        language={presented.language}
        starterCode={presented.starterCode}
        starterFiles={presented.starterFiles}
        entryPath={presented.entryPath}
        saved={saved}
        onFilesChange={queueCodeSave}
        onLargePaste={reportLargePaste}
        runs={runs}
        running={running}
        runNote={runNote}
        onRun={onRun}
        saveState={saveState}
      />
    );
  }

  return (
    <div className="card">
      <span className="badge blue">{formatLabel(format)}</span>
      <p style={{ fontSize: '1.05rem', margin: '10px 0 4px' }}>{presented.prompt}</p>

      {format === 'SWIPE_MCQ' && (
        <SwipeBody
          options={presented.options ?? []}
          saved={asSwipeSaved(saved)}
          onAnswer={postAnswer}
        />
      )}

      {format === 'MCQ' && (
        <McqBody
          group={`mcq-q${order}`}
          options={presented.options ?? []}
          saved={asMcqSaved(saved)}
          onAnswer={postAnswer}
        />
      )}

      {format === 'WRITTEN' && (
        <WrittenBody
          saved={asTextSaved(saved)}
          onTextChange={queueTextSave}
          onLargePaste={reportLargePaste}
        />
      )}
    </div>
  );
}

function formatLabel(format: string): string {
  switch (format) {
    case 'SWIPE_MCQ':
      return 'Select all true statements';
    case 'MCQ':
      return 'Multiple choice';
    case 'WRITTEN':
      return 'Written answer';
    case 'CODE':
      return 'Coding task';
    default:
      return format;
  }
}

function asSwipeSaved(saved: unknown): Record<string, SwipeValuation> {
  if (typeof saved === 'object' && saved !== null && !Array.isArray(saved)) {
    return saved as Record<string, SwipeValuation>;
  }
  return {};
}
function asMcqSaved(saved: unknown): string | null {
  if (typeof saved === 'object' && saved !== null && 'optionId' in saved) {
    return String((saved as { optionId: unknown }).optionId);
  }
  return null;
}
function asTextSaved(saved: unknown): string | null {
  if (typeof saved === 'object' && saved !== null && 'text' in saved) {
    const t = (saved as { text: unknown }).text;
    if (typeof t === 'string') return t;
  }
  return null;
}

function SwipeBody({
  options,
  saved,
  onAnswer,
}: {
  options: Array<{ id: string; text: string }>;
  saved: Record<string, SwipeValuation>;
  onAnswer: (content: Record<string, SwipeValuation>) => void;
}): JSX.Element {
  const [state, setState] = useState<Record<string, SwipeValuation>>(saved);

  function toggle(optionId: string, checked: boolean): void {
    // Standard web questionnaire: checked = agreed/true (LIKE), unchecked =
    // disagreed/false (DISLIKE). Identical wire format to the mobile swipe
    // cards, so server-side scoring is untouched.
    const next = { ...state };
    next[optionId] = checked ? 'LIKE' : 'DISLIKE';
    setState(next);
    onAnswer(next);
  }

  return (
    <div>
      <p className="hint">Select all statements that are true. Leave the false ones unchecked.</p>
      {options.map((option) => {
        const checked = state[option.id] === 'LIKE';
        return (
          <label key={option.id} className="swipe-option" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => toggle(option.id, e.target.checked)}
              style={{ width: 18, height: 18, accentColor: '#1d4ed8', flexShrink: 0 }}
            />
            <span className="text">{option.text}</span>
          </label>
        );
      })}
    </div>
  );
}

function McqBody({
  group,
  options,
  saved,
  onAnswer,
}: {
  group: string;
  options: Array<{ id: string; text: string }>;
  saved: string | null;
  onAnswer: (content: { optionId: string }) => void;
}): JSX.Element {
  return (
    <div>
      <p className="hint">Pick one answer.</p>
      {options.map((option) => (
        <label
          key={option.id}
          className={`mcq-option${saved === option.id ? ' selected' : ''}`}
        >
          <input
            type="radio"
            name={`${group}-${option.id}`}
            checked={saved === option.id}
            onChange={() => onAnswer({ optionId: option.id })}
            style={{ width: 'auto', marginTop: 4 }}
          />
          <span>{option.text}</span>
        </label>
      ))}
    </div>
  );
}

function WrittenBody({
  saved,
  onTextChange,
  onLargePaste,
}: {
  saved: string | null;
  onTextChange: (text: string) => void;
  onLargePaste: (chars: number) => void;
}): JSX.Element {
  const [text, setText] = useState(saved ?? '');
  return (
    <div>
      <p className="hint">Your answer saves automatically as you type.</p>
      <textarea
        value={text}
        maxLength={10_000}
        onPaste={(e) => onLargePaste(e.clipboardData.getData('text').length)}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange(e.target.value);
        }}
      />
    </div>
  );
}

// Monaco is a ~MB-scale dependency: import lazily so only CODE questions pay.
const CodeEditor = lazy(async () => import('./CodeEditor'));

/** Path grammar mirrored from the API's codeAnswer.ts (same on both sides). */
const FILE_PATH_REGEX = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/;
const MAX_CODE_FILES = 8;
const MAX_FILE_CHARS = 20_000;

function defaultEntryName(language: string | undefined): string {
  if (language === 'NODE') return 'main.js';
  if (language === 'BASH') return 'main.sh';
  return 'main.py';
}

/** The saved answer, either arm, as the initial workspace. */
function initialWorkspace(
  saved: unknown,
  starterFiles: CodeFileView[] | undefined,
  entryPath: string | undefined,
  starterCode: string | undefined,
  language: string | undefined,
): { files: CodeFileView[]; entry: string } {
  if (typeof saved === 'object' && saved !== null && Array.isArray((saved as { files?: unknown }).files)) {
    const raw = (saved as { files: unknown[]; entry?: unknown }).files.filter(
      (f): f is { path: string; content: string } =>
        typeof f === 'object' && f !== null &&
        typeof (f as { path?: unknown }).path === 'string' && typeof (f as { content?: unknown }).content === 'string',
    );
    if (raw.length > 0) {
      const entry =
        typeof (saved as { entry?: unknown }).entry === 'string' &&
        raw.some((f) => f.path === (saved as { entry: string }).entry)
          ? (saved as { entry: string }).entry
          : raw[0]!.path;
      return { files: raw.map((f) => ({ path: f.path, content: f.content })), entry };
    }
  }
  if (starterFiles !== undefined && starterFiles.length > 0) {
    const entry = entryPath !== undefined && starterFiles.some((f) => f.path === entryPath)
      ? entryPath
      : starterFiles[0]!.path;
    return { files: starterFiles.map((f) => ({ ...f })), entry };
  }
  // Legacy single-file: saved {text} (or starterCode) becomes the entry file.
  let text = '';
  if (typeof saved === 'object' && saved !== null && typeof (saved as { text?: unknown }).text === 'string') {
    text = (saved as { text: string }).text;
  } else if (typeof starterCode === 'string') {
    text = starterCode;
  }
  return { files: [{ path: defaultEntryName(language), content: text }], entry: defaultEntryName(language) };
}

function CodeBody({
  order,
  prompt,
  language,
  starterCode,
  starterFiles,
  entryPath,
  saved,
  onFilesChange,
  onLargePaste,
  runs,
  running,
  runNote,
  onRun,
  saveState,
}: {
  order: number;
  prompt: string;
  language?: string;
  starterCode?: string;
  starterFiles?: CodeFileView[];
  entryPath?: string;
  saved: unknown;
  onFilesChange: (files: CodeFileView[], entry: string) => void;
  onLargePaste: (chars: number) => void;
  runs: CodeRunView[];
  running: boolean;
  runNote: string;
  onRun: (args: string[]) => void;
  saveState: SaveState;
}): JSX.Element {
  const initial = initialWorkspace(saved, starterFiles, entryPath, starterCode, language);
  const [files, setFiles] = useState<CodeFileView[]>(initial.files);
  const [entry, setEntry] = useState(initial.entry);
  const [active, setActive] = useState(initial.entry);
  const [argsText, setArgsText] = useState('');
  const [cursor, setCursor] = useState({ ln: 1, col: 1 });
  const [newPath, setNewPath] = useState('');
  const [fileNote, setFileNote] = useState('');

  const langLabel = language === 'PYTHON' ? 'Python' : language === 'NODE' ? 'JavaScript' : language === 'BASH' ? 'Bash' : 'Plain';
  const activeFile = files.find((f) => f.path === active) ?? files[0]!;

  function commit(nextFiles: CodeFileView[], nextEntry: string): void {
    setFiles(nextFiles);
    setEntry(nextEntry);
    onFilesChange(nextFiles, nextEntry);
  }

  function editActive(content: string): void {
    // Same per-file cap the API enforces — longer saves are rejected.
    const capped = content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) : content;
    commit(files.map((f) => (f.path === activeFile.path ? { ...f, content: capped } : f)), entry);
  }

  function addFile(): void {
    const path = newPath.trim();
    setFileNote('');
    if (!FILE_PATH_REGEX.test(path) || path.includes('..')) {
      setFileNote('Paths: letters, digits, dot, underscore, dash, slash — relative, no "..".');
      return;
    }
    if (files.some((f) => f.path === path)) {
      setFileNote('A file with that path already exists.');
      return;
    }
    if (files.length >= MAX_CODE_FILES) {
      setFileNote(`At most ${MAX_CODE_FILES} files.`);
      return;
    }
    commit([...files, { path, content: '' }], entry);
    setActive(path);
    setNewPath('');
  }

  function removeFile(path: string): void {
    if (path === entry) return; // the entry file cannot be removed
    const next = files.filter((f) => f.path !== path);
    if (next.length === 0) return;
    commit(next, entry);
    if (active === path) setActive(entry);
  }

  function run(): void {
    // Space-separated args → argv tokens (mirrors the hidden-case arg shape).
    const args = argsText.split(/\s+/).map((a) => a.trim()).filter((a) => a !== '').slice(0, 10);
    onRun(args);
  }

  const latest = runs.length > 0 ? runs[0] : null;

  return (
    <div className="ide">
      {/* Left: the task + file explorer sidebar */}
      <aside className="ide-side">
        <div className="ide-side-head">TASK · Q{order}</div>
        <div className="ide-task">
          <span className="badge blue">Coding task</span>
          <div style={{ marginTop: 8 }}>{prompt}</div>
          <p className="hint" style={{ marginTop: 12 }}>
            Your code saves automatically. Hidden test cases run only after you submit.
          </p>
        </div>
        <div className="ide-files">
          <div className="ide-side-head">FILES</div>
          <ul>
            {files.map((f) => (
              <li key={f.path} className={f.path === active ? 'active' : undefined}>
                <span
                  role="button"
                  tabIndex={0}
                  style={{ cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  onClick={() => setActive(f.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setActive(f.path);
                  }}
                >
                  {f.path}
                </span>
                {f.path === entry ? (
                  <span className="ide-entry-tag">entry</span>
                ) : (
                  <span className="ide-file-actions">
                    <button type="button" className="ide-mini" title="Make this the entry file" onClick={() => commit(files, f.path)}>
                      ⤴ entry
                    </button>
                    <button type="button" className="ide-mini" title="Remove file" onClick={() => removeFile(f.path)}>
                      ×
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <div className="ide-newfile">
            <input
              aria-label="New file path"
              placeholder="new file e.g. helpers.py"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFile();
              }}
            />
            <button type="button" className="ide-mini" onClick={addFile} disabled={newPath.trim() === ''}>
              + add
            </button>
          </div>
          {fileNote !== '' && <p className="ide-file-note">{fileNote}</p>}
        </div>
      </aside>

      {/* Right: editor column with tab strip + status bar + terminal */}
      <div className="ide-main">
        <div className="ide-tabs">
          {files.map((f) => (
            <div
              key={f.path}
              className={`ide-tab${f.path === active ? ' active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => setActive(f.path)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setActive(f.path);
              }}
            >
              {f.path}
              {f.path === entry ? <span className="ide-entry-tag" style={{ marginLeft: 8 }}>entry</span> : null}
            </div>
          ))}
          <div className="ide-actions">
            <span className="ide-run-hint">⌘/Ctrl+↵</span>
            <button type="button" className="ide-run" onClick={run} disabled={running}>
              {running ? 'Running…' : '▶ Run'}
            </button>
          </div>
        </div>

        <div className="ide-editor">
          <Suspense fallback={<div className="ide-loading">Loading editor…</div>}>
            <CodeEditor
              key={activeFile.path}
              language={language}
              value={activeFile.content}
              onChange={editActive}
              onRun={run}
              onLargePaste={onLargePaste}
              onCursor={(ln, col) => setCursor({ ln, col })}
            />
          </Suspense>
        </div>

        <div className="ide-status">
          <span>{langLabel}</span>
          <span>{activeFile.path}</span>
          <span>Ln {cursor.ln}, Col {cursor.col}</span>
          <span>Spaces: 4</span>
          <span style={{ marginLeft: 'auto' }}>
            {saveState === 'saving' && 'Saving…'}
            {saveState === 'saved' && <span className="ok">✓ Saved</span>}
            {saveState === 'error' && <span className="fail">Save failed — retry an edit</span>}
            {saveState === 'idle' && 'Autosave on'}
          </span>
        </div>

        <div className="ide-console">
          <div className="ide-console-head">
            <span className="label">CONSOLE</span>
            {latest !== null && latest.status === 'DONE' && (
              <span className={latest.exitCode === 0 ? 'pass' : 'fail'}>
                exit {latest.exitCode ?? '?'}{latest.durationMs !== null ? ` · ${latest.durationMs} ms` : ''}
              </span>
            )}
            {latest !== null && latest.status === 'FAILED' && <span className="fail">run failed</span>}
            {latest !== null && latest.argsUsed !== null && latest.argsUsed.length > 0 && (
              <span>$ {latest.argsUsed.join(' ')}</span>
            )}
            <span style={{ marginLeft: 'auto' }}>args</span>
            <input
              className="ide-args"
              aria-label="Program arguments"
              placeholder="e.g. 3 5 --flag"
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') run();
              }}
            />
          </div>
          <div className="ide-output">
            {runNote !== '' && <div className="meta fail">{runNote}</div>}
            {latest === null && running === false && (
              <pre className="meta" style={{ color: '#7d8590' }}>
                {'// press Run (or ⌘/Ctrl+Enter) to execute your code here'}
              </pre>
            )}
            {running && <pre style={{ color: '#7d8590' }}>{'▌ running…'}</pre>}
            {latest !== null && latest.stdout !== '' && <pre>{latest.stdout}</pre>}
            {latest !== null && latest.stderr !== '' && <pre className="err">{latest.stderr}</pre>}
            {latest !== null && latest.truncated && (
              <div className="meta">output truncated — 64 KB cap per stream</div>
            )}
            {latest !== null && latest.error !== null && <div className="meta fail">{latest.error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

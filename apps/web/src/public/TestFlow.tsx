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

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api, isNotFound } from '../api/client';
import {
  asPresented,
  type AnswerContent,
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

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; err: unknown }
  | { kind: 'link-not-found' }
  | { kind: 'link-expired'; jobTitle?: string }
  | { kind: 'already-submitted'; jobTitle: string }
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
        <div className="card">
          <div className="submitted-hero">Submitted ✓</div>
          <p className="center sub">
            This test{phase.jobTitle ? ` (${phase.jobTitle})` : ''} was already submitted. Nothing
            further is needed.
          </p>
        </div>,
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
        <div className="card">
          <div className="submitted-hero">Submitted ✓</div>
          <p className="center sub">
            Your answers have been received. The hiring team will take it from here.
          </p>
        </div>,
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
  const [ended, setEnded] = useState<'submitted' | 'time-up' | null>(null);

  const submittedRef = useRef(false); // guards the one-shot auto-submit at zero
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef<{ order: number; text: string } | null>(null);

  const signals = useSignals(token, ended === null);
  const sessionActive = ended === null;

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

  // Debounced save for text formats (WRITTEN / CODE).
  const queueTextSave = useCallback(
    (order: number, text: string): void => {
      lastTextRef.current = { order, text };
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const last = lastTextRef.current;
        if (last !== null) void postAnswer(last.order, { text: last.text });
      }, TEXT_SAVE_DEBOUNCE_MS);
    },
    [postAnswer],
  );

  useEffect(
    () => () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    },
    [],
  );

  /** Submit (manual or clock-driven); flushes signals first. */
  async function finalize(auto: boolean): Promise<void> {
    // Flush the pending debounced text so the final keystrokes are included.
    if (debounceRef.current !== null) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const last = lastTextRef.current;
    if (last !== null && sessionActive) {
      await api.post(`/public/test/${token}/answers`, { order: last.order, content: { text: last.text } }).catch(() => undefined);
    }
    await signals.flush();
    setSubmitting(true);
    try {
      await api.post(`/public/test/${token}/submit`, {});
      setEnded('submitted');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
        // Outside the 60s grace window: the saved answers stand, unsaved tail lost.
        void auto;
        setEnded('time-up');
        return;
      }
      setSaveState('error');
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  if (ended === 'submitted') {
    return shell(
      <div className="card">
        <div className="submitted-hero">Submitted ✓</div>
        <p className="center sub">Your answers have been received. The hiring team will take it from here.</p>
      </div>,
    );
  }
  if (ended === 'time-up') {
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

      {current !== undefined && (
        <QuestionCard
          key={current.order}
          order={current.order}
          format={current.format}
          presented={asPresented(current.presented)}
          saved={answers[String(current.order)]}
          postAnswer={(content) => void postAnswer(current.order, content)}
          queueTextSave={(text) => queueTextSave(current.order, text)}
          pushSignal={signals.push}
        />
      )}

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
  pushSignal,
}: {
  order: number;
  format: string;
  presented: { prompt: string; options?: Array<{ id: string; text: string }>; language?: string; starterCode?: string };
  saved: unknown;
  postAnswer: (content: AnswerContent) => void;
  queueTextSave: (text: string) => void;
  pushSignal: (type: SignalType, detail?: Record<string, unknown>) => void;
}): JSX.Element {
  // LARGE_PASTE detection shared by every text-bearing format.
  function onPaste(e: React.ClipboardEvent): void {
    const text = e.clipboardData.getData('text');
    if (text.length > PASTE_SIGNAL_THRESHOLD) {
      pushSignal('LARGE_PASTE', { chars: text.length, order });
    }
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
          onPaste={onPaste}
        />
      )}

      {format === 'CODE' && (
        <CodeBody
          language={presented.language}
          starterCode={presented.starterCode}
          saved={asTextSaved(saved)}
          onTextChange={queueTextSave}
          onPaste={onPaste}
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
  onPaste,
}: {
  saved: string | null;
  onTextChange: (text: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
}): JSX.Element {
  const [text, setText] = useState(saved ?? '');
  return (
    <div>
      <p className="hint">Your answer saves automatically as you type.</p>
      <textarea
        value={text}
        maxLength={10_000}
        onPaste={onPaste}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange(e.target.value);
        }}
      />
    </div>
  );
}

function CodeBody({
  language,
  starterCode,
  saved,
  onTextChange,
  onPaste,
}: {
  language?: string;
  starterCode?: string;
  saved: string | null;
  onTextChange: (text: string) => void;
  onPaste: (e: React.ClipboardEvent) => void;
}): JSX.Element {
  const [text, setText] = useState(saved ?? starterCode ?? '');
  return (
    <div>
      <p className="hint">
        Language: <code>{language ?? 'unspecified'}</code>. Your code saves automatically; it will
        be executed against hidden test cases after submission.
      </p>
      <textarea
        className="code"
        spellCheck={false}
        value={text}
        maxLength={10_000}
        onPaste={onPaste}
        onChange={(e) => {
          setText(e.target.value);
          onTextChange(e.target.value);
        }}
      />
    </div>
  );
}

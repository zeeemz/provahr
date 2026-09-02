// The proctored session runner — mobile mirror of SessionRunner in
// apps/web/src/public/TestFlow.tsx. Same contract and same behavioral rules:
// - The clock (meta.deadlineAt) never pauses; at zero we auto-submit inside
//   the API's 60s grace window so a candidate mid-typing still lands.
// - Answers POST per change (text debounced 900ms); the question stepper is
//   the bounded review pass — answers can change while the clock runs.
// - Signals are evidence only, batched and flushed every 10s + at submit;
//   on mobile the background event is APP_BACKGROUND (AppState), the
//   TAB_SWITCH equivalent.
// - The submitted state shows nothing but the confirmation (asymmetry is the
//   product). Scores/verdicts exist only in the HR X-ray.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, errMessage } from '../api/client';
import { ApiError } from '../api/client';
import type { AnswerContent, PresentedQuestion, SessionView, SignalType, SwipeValuation } from '../api/types';
import { asPresented } from '../api/types';
import { useSignals } from '../hooks/useSignals';
import { SwipeDeck } from '../components/SwipeDeck';
import { Card, COLORS, ErrorBox, PrimaryButton, Spinner } from '../ui';
import { mmss } from '../util';

const PASTE_JUMP_THRESHOLD = 500; // chars appearing in one change ≈ a paste (RN has no paste event)
const TEXT_SAVE_DEBOUNCE_MS = 900;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function TestSessionScreen({ token }: { token: string }): JSX.Element {
  const [view, setView] = useState<SessionView | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [index, setIndex] = useState(0); // 0-based position in questions order
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [ended, setEnded] = useState<'submitted' | 'time-up' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submittedRef = useRef(false); // guards the one-shot auto-submit at zero
  const endedRef = useRef<'submitted' | 'time-up' | null>(null);
  endedRef.current = ended;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTextRef = useRef<{ order: number; text: string } | null>(null);

  const signals = useSignals(token, ended === null);
  const sessionActive = ended === null;

  // Load / re-enter the session view (start already happened; GET .../session
  // is refresh-safe, so closing and reopening the app mid-test heals state).
  useEffect(() => {
    let cancelled = false;
    api
      .get<SessionView>(`/public/test/${token}/session`)
      .then((v) => {
        if (!cancelled) setView(v);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const deadline = view !== null ? new Date(view.meta.deadlineAt).getTime() : null;

  /** Submit (manual or clock-driven); flushes pending text + signals first. */
  const finalize = useCallback(
    async (): Promise<void> => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const last = lastTextRef.current;
      if (last !== null && endedRef.current === null) {
        await api.post(`/public/test/${token}/answers`, { order: last.order, content: { text: last.text } }).catch(() => undefined);
      }
      await signals.flush();
      setSubmitting(true);
      setSubmitError(null);
      try {
        await api.post(`/public/test/${token}/submit`, {});
        setEnded('submitted');
      } catch (err) {
        if (err instanceof ApiError && err.code === 'SESSION_EXPIRED') {
          // Outside the 60s grace window: the saved answers stand, unsaved tail lost.
          setEnded('time-up');
          return;
        }
        setSaveState('error');
        setSubmitError(errMessage(err));
      } finally {
        setSubmitting(false);
      }
    },
    [token, signals],
  );

  // Keep a stable handle for the one-shot clock-driven submit below.
  const finalizeRef = useRef(finalize);
  finalizeRef.current = finalize;

  // The clock: 4 ticks/second; at zero, exactly one submit attempt.
  useEffect(() => {
    if (deadline === null || !sessionActive) return;
    const tick = (): void => {
      const left = deadline - Date.now();
      setRemainingMs(left);
      if (left <= 0 && !submittedRef.current) {
        submittedRef.current = true;
        void finalizeRef.current();
      }
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [deadline, sessionActive]);

  const questions = view?.questions ?? [];
  const current = questions[index];
  const answers = view?.answers ?? {};

  // Answer POST wrapper: SESSION_EXPIRED means the clock won — attempt the
  // grace-window submit; anything else surfaces as a save error.
  const postAnswer = useCallback(
    async (order: number, content: AnswerContent): Promise<void> => {
      if (endedRef.current !== null) return;
      setSaveState('saving');
      try {
        await api.post(`/public/test/${token}/answers`, { order, content });
        setSaveState('saved');
        setView((v) => (v === null ? v : { ...v, answers: { ...v.answers, [String(order)]: content } }));
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'SESSION_EXPIRED' || err.code === 'SESSION_SUBMITTED')) {
          if (!submittedRef.current) {
            submittedRef.current = true;
            void finalizeRef.current();
          }
          return;
        }
        setSaveState('error');
      }
    },
    [token],
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

  if (ended === 'submitted') {
    return (
      <Card style={styles.centerCard}>
        <Text style={styles.hero}>Submitted ✓</Text>
        <Text style={styles.centerSub}>Your answers have been received. The hiring team will take it from here.</Text>
      </Card>
    );
  }
  if (ended === 'time-up') {
    return (
      <Card>
        <Text style={styles.h2}>Time is up</Text>
        <Text style={styles.sub}>
          The clock never pauses. Everything you saved before zero was submitted with the session.
        </Text>
      </Card>
    );
  }

  if (loadError !== null) {
    return <ErrorBox err={loadError} />;
  }
  if (view === null) {
    return <Spinner label="Loading your questions…" />;
  }

  const danger = remainingMs !== null && remainingMs < 60_000;

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          Question {index + 1} of {questions.length}
        </Text>
        <Text style={[styles.timer, danger ? styles.timerDanger : null]}>
          ⏱ {remainingMs !== null ? mmss(remainingMs) : '--:--'}
        </Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((index + 1) / Math.max(1, questions.length)) * 100}%` }]} />
      </View>
      <Text style={styles.saveState}>
        {saveState === 'saving' && 'Saving…'}
        {saveState === 'saved' && 'Saved ✓'}
        {saveState === 'error' && <Text style={styles.saveError}>Could not save the last change — try again.</Text>}
      </Text>

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

      <View style={styles.navRow}>
        <PrimaryButton label="← Previous" tone="ghost" onPress={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} />
        {index < questions.length - 1 ? (
          <PrimaryButton label="Next →" onPress={() => setIndex((i) => i + 1)} />
        ) : (
          <PrimaryButton label={submitting ? 'Submitting…' : 'Submit test'} onPress={() => void finalizeRef.current()} disabled={submitting} />
        )}
      </View>
      {index === questions.length - 1 && (
        <Text style={styles.hint}>
          Submitting ends the session — you can still go back and revise first. You may also navigate back
          without submitting; the clock keeps running either way.
        </Text>
      )}
      {submitError !== null && <Text style={styles.submitError}>Submit failed: {submitError}. Try again.</Text>}
    </ScrollView>
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
  presented: PresentedQuestion;
  saved: unknown;
  postAnswer: (content: AnswerContent) => void;
  queueTextSave: (text: string) => void;
  pushSignal: (type: SignalType, detail?: Record<string, unknown>) => void;
}): JSX.Element {
  return (
    <Card>
      <Text style={styles.badgeFormat}>{formatLabel(format)}</Text>
      <Text style={styles.prompt}>{presented.prompt}</Text>

      {format === 'SWIPE_MCQ' && (
        <SwipeDeck options={presented.options ?? []} saved={asSwipeSaved(saved)} onChange={postAnswer} />
      )}

      {format === 'MCQ' && (
        <McqBody options={presented.options ?? []} saved={asMcqSaved(saved)} onAnswer={postAnswer} />
      )}

      {format === 'WRITTEN' && (
        <TextBody
          saved={asTextSaved(saved)}
          onTextChange={queueTextSave}
          pushSignal={pushSignal}
          order={order}
          kind="written"
        />
      )}

      {format === 'CODE' && (
        <TextBody
          saved={asTextSaved(saved)}
          starterCode={presented.starterCode}
          language={presented.language}
          onTextChange={queueTextSave}
          pushSignal={pushSignal}
          order={order}
          kind="code"
        />
      )}
    </Card>
  );
}

function formatLabel(format: string): string {
  switch (format) {
    case 'SWIPE_MCQ':
      return 'Like / dislike each statement';
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

function McqBody({
  options,
  saved,
  onAnswer,
}: {
  options: Array<{ id: string; text: string }>;
  saved: string | null;
  onAnswer: (content: { optionId: string }) => void;
}): JSX.Element {
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={styles.hint}>Pick one answer.</Text>
      {options.map((option) => {
        const selected = saved === option.id;
        return (
          <Pressable
            key={option.id}
            onPress={() => onAnswer({ optionId: option.id })}
            style={[styles.mcqOption, selected ? styles.mcqSelected : null]}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
          >
            <View style={[styles.radio, selected ? styles.radioOn : null]}>
              {selected && <View style={styles.radioDot} />}
            </View>
            <Text style={styles.mcqText}>{option.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * WRITTEN / CODE share one body: a multiline TextInput with debounced
 * autosave. RN has no paste event, so LARGE_PASTE parity is approximated by
 * watching for an instantaneous insertion larger than the web threshold.
 */
function TextBody({
  saved,
  starterCode,
  language,
  onTextChange,
  pushSignal,
  order,
  kind,
}: {
  saved: string | null;
  starterCode?: string;
  language?: string;
  onTextChange: (text: string) => void;
  pushSignal: (type: SignalType, detail?: Record<string, unknown>) => void;
  order: number;
  kind: 'written' | 'code';
}): JSX.Element {
  const [text, setText] = useState(saved ?? starterCode ?? '');
  const prevLenRef = useRef(text.length);

  function change(next: string): void {
    const jump = next.length - prevLenRef.current;
    if (jump > PASTE_JUMP_THRESHOLD) {
      pushSignal('LARGE_PASTE', { chars: jump, order });
    }
    prevLenRef.current = next.length;
    setText(next);
    onTextChange(next);
  }

  return (
    <View style={{ marginTop: 8 }}>
      {kind === 'code' ? (
        <Text style={styles.hint}>
          Language: {language ?? 'unspecified'}. Your code saves automatically; it will be executed against
          hidden test cases after submission.
        </Text>
      ) : (
        <Text style={styles.hint}>Your answer saves automatically as you type.</Text>
      )}
      <TextInput
        value={text}
        onChangeText={change}
        multiline
        maxLength={10_000}
        style={[styles.textArea, kind === 'code' ? styles.codeArea : null]}
        placeholder={kind === 'code' ? '// write your code here' : 'Type your answer…'}
        placeholderTextColor="#94a3b8"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  metaText: { color: COLORS.ink, fontSize: 15, fontWeight: '700' },
  timer: { fontSize: 16, fontWeight: '800', color: COLORS.ink, fontVariant: ['tabular-nums'] },
  timerDanger: { color: COLORS.red },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: COLORS.line, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: COLORS.blue },
  saveState: { minHeight: 22, color: COLORS.sub, fontSize: 13, marginTop: 6 },
  saveError: { color: COLORS.red },
  submitError: { color: COLORS.red, fontSize: 13, marginTop: 8 },
  badgeFormat: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.blueSoft,
    color: '#1d4ed8',
    fontWeight: '700',
    fontSize: 12,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  prompt: { color: COLORS.ink, fontSize: 17, lineHeight: 24, fontWeight: '600', marginTop: 10 },
  hint: { color: COLORS.sub, fontSize: 13, lineHeight: 18, marginTop: 4 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 12 },
  mcqOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginTop: 8,
    backgroundColor: '#ffffff',
  },
  mcqSelected: { borderColor: COLORS.blue, backgroundColor: '#eff6ff' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: COLORS.blue },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.blue },
  mcqText: { flex: 1, color: COLORS.ink, fontSize: 15, lineHeight: 21 },
  textArea: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 15,
    color: COLORS.ink,
    minHeight: 140,
  },
  codeArea: { fontFamily: 'monospace', fontSize: 13 },
  h2: { fontSize: 18, fontWeight: '700', color: COLORS.ink, marginBottom: 6 },
  sub: { color: COLORS.sub, fontSize: 14, lineHeight: 20 },
  centerCard: { alignItems: 'center', paddingVertical: 32 },
  hero: { fontSize: 34, fontWeight: '900', color: COLORS.green, marginBottom: 8 },
  centerSub: { color: COLORS.sub, fontSize: 14, textAlign: 'center' },
});

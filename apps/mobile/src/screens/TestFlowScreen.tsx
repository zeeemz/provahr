// Candidate test flow — consent → proctored session → "Submitted ✓".
// Mobile mirror of apps/web/src/public/TestFlow.tsx (same phases, same
// endpoint semantics; only the monitoring disclosure is platform-honest:
// the app records APP_BACKGROUND when you leave it, where the web records
// TAB_SWITCH).
//
// Endpoints (public.router / session.service):
//   GET  /api/public/test/:token          consent meta (never items)
//   POST /api/public/test/:token/start    draw + variants + clock (idempotent)
//   GET  /api/public/test/:token/session  refresh-safe session view
//   POST /api/public/test/:token/answers  { order, content } — autosaved
//   POST /api/public/test/:token/signals  batched proctoring evidence
//   POST /api/public/test/:token/submit   → { submitted: true } — nothing else

import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api, isNotFound } from '../api/client';
import type { SessionView, TestLinkInfo } from '../api/types';
import { Card, ErrorBox, PrimaryButton, Spinner } from '../ui';
import { fmtDateTime } from '../util';
import { TestSessionScreen } from './TestSessionScreen';

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
  | { kind: 'time-up' };

export function TestFlowScreen({ token, onExit }: { token: string; onExit: () => void }): JSX.Element {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    api
      .get<TestLinkInfo>(`/public/test/${token}`)
      .then((info) => {
        if (cancelled) return;
        if (info.status === 'EXPIRED') setPhase({ kind: 'link-expired', jobTitle: info.jobTitle });
        else if (info.status === 'SUBMITTED') setPhase({ kind: 'already-submitted', jobTitle: info.jobTitle });
        else if (info.status === 'STARTED') setPhase({ kind: 'resume', info });
        else setPhase({ kind: 'consent', info });
      })
      .catch((err: unknown) => {
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
      return <Spinner label="Opening your test link…" />;
    case 'error':
      return <ErrorBox err={phase.err} />;
    case 'link-not-found':
      return (
        <Card>
          <Text style={styles.h2}>Test link not found</Text>
          <Text style={styles.sub}>This link doesn&apos;t exist, was mistyped, or is malformed.</Text>
          <Text style={styles.sub}>Check that you copied the full code from your application confirmation.</Text>
          <PrimaryButton label="Back to open roles" onPress={onExit} tone="ghost" />
        </Card>
      );
    case 'link-expired':
      return (
        <Card>
          <Text style={styles.h2}>Test link expired</Text>
          <Text style={styles.sub}>
            This test link has expired{phase.jobTitle ? ` (${phase.jobTitle})` : ''}. Test links are time-boxed
            and single-use — contact the employer if you still want to be considered.
          </Text>
          <PrimaryButton label="Back to open roles" onPress={onExit} tone="ghost" />
        </Card>
      );
    case 'already-submitted':
      return (
        <Card style={styles.centerCard}>
          <Text style={styles.hero}>Submitted ✓</Text>
          <Text style={styles.centerSub}>
            This test{phase.jobTitle ? ` (${phase.jobTitle})` : ''} was already submitted. Nothing further is
            needed.
          </Text>
        </Card>
      );
    case 'consent':
      return <ConsentScreen info={phase.info} onStart={() => void beginSession()} />;
    case 'resume':
      return <ConsentScreen info={phase.info} onStart={() => void beginSession()} resume />;
    case 'starting':
      return <Spinner label="Drawing your questions…" />;
    case 'session':
      return <TestSessionScreen token={token} />;
    case 'submitted':
      return (
        <Card style={styles.centerCard}>
          <Text style={styles.hero}>Submitted ✓</Text>
          <Text style={styles.centerSub}>
            Your answers have been received. The hiring team will take it from here.
          </Text>
        </Card>
      );
    case 'time-up':
      return (
        <Card>
          <Text style={styles.h2}>Time is up</Text>
          <Text style={styles.sub}>
            The clock never pauses. Your saved answers were submitted with the session; anything still
            unsaved when the clock hit zero was not.
          </Text>
        </Card>
      );
  }
}

// ─── Consent ──────────────────────────────────────────────────────────────────

function ConsentScreen({
  info,
  onStart,
  resume,
}: {
  info: TestLinkInfo;
  onStart: () => void;
  resume?: boolean;
}): JSX.Element {
  const [agreed, setAgreed] = useState(false);

  return (
    <Card>
      <Text style={styles.h1}>{info.jobTitle}</Text>
      <Text style={styles.sub}>
        {resume ? 'Your test is in progress — the clock never paused.' : 'Skill test'} ·{' '}
        {info.timeLimitMin !== null ? `${info.timeLimitMin} minutes, one sitting` : 'Time-boxed, one sitting'}
      </Text>

      {resume === true && (
        <Text style={styles.warn}>
          You already started this test. Re-entering does not stop or reset the clock.
        </Text>
      )}

      <Text style={styles.h3}>Before you begin — what is monitored</Text>
      <View style={styles.list}>
        <Text style={styles.li}>
          • App-background detection (leaving, minimizing, or switching away from the app is recorded)
        </Text>
        <Text style={styles.li}>• Paste detection (very large pastes are recorded)</Text>
        <Text style={styles.li}>• Timing analysis (how long you take, per question and overall)</Text>
        <Text style={styles.liBold}>• No camera. No screen recording. Nothing visual is captured.</Text>
      </View>
      <Text style={styles.hint}>
        These signals are fairness evidence for a human reviewer — they never decide anything on their own.
      </Text>

      <Text style={styles.h3}>Rules of the session</Text>
      <View style={styles.list}>
        <Text style={styles.li}>• One question at a time; you can go back to review while the clock runs</Text>
        <Text style={styles.li}>
          • The clock starts when you tap below and never pauses — not on closing the app, not on re-entry
        </Text>
        <Text style={styles.li}>• Your answers save automatically as you go</Text>
        <Text style={styles.li}>• This link is single-use: once submitted, it is done</Text>
      </View>

      <Pressable style={styles.consentRow} onPress={() => setAgreed((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }}>
        <View style={[styles.checkbox, agreed ? styles.checkboxOn : null]}>
          {agreed && <Text style={styles.checkboxMark}>✓</Text>}
        </View>
        <Text style={styles.consentText}>
          I understand this test is monitored (app-background/paste/timing signals; no camera)
        </Text>
      </Pressable>

      <View style={{ marginTop: 18 }}>
        <PrimaryButton
          label={resume === true ? 'Re-enter the test' : 'Start the test'}
          onPress={onStart}
          disabled={!agreed}
        />
      </View>
      <Text style={styles.hint}>Link expires {fmtDateTime(info.expiresAt)} if never started.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  h1: { fontSize: 22, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  h2: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  h3: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 16, marginBottom: 6 },
  sub: { color: '#64748b', fontSize: 14, lineHeight: 20, marginBottom: 6 },
  warn: { color: '#b45309', fontSize: 13, marginTop: 6 },
  list: { gap: 4 },
  li: { color: '#334155', fontSize: 14, lineHeight: 20 },
  liBold: { color: '#0f172a', fontSize: 14, lineHeight: 20, fontWeight: '700' },
  hint: { color: '#64748b', fontSize: 12, lineHeight: 17, marginTop: 10 },
  centerCard: { alignItems: 'center', paddingVertical: 32 },
  hero: { fontSize: 34, fontWeight: '900', color: '#16a34a', marginBottom: 8 },
  centerSub: { color: '#64748b', fontSize: 14, textAlign: 'center' },
  consentRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#94a3b8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  checkboxMark: { color: '#ffffff', fontWeight: '900', fontSize: 14 },
  consentText: { flex: 1, fontSize: 14, color: '#334155', lineHeight: 19 },
});

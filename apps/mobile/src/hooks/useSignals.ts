// Signal collection (batched, evidence-only) — the mobile twin of the
// useSignals hook inside apps/web/src/public/TestFlow.tsx, with signal PARITY
// by platform (PLAN.md D13): where the web portal reports TAB_SWITCH on
// document visibilitychange, the app reports APP_BACKGROUND when the OS moves
// us to the background. Both land in the same API vocabulary
// (POST /api/public/test/:token/signals), so sessions produce comparable
// evidence across platforms.
//
// Batch policy (identical to web): queue client-side, flush every 10s and at
// submit; a failed flush is dropped, never blocking. One mobile addition:
// when the app backgrounds we fire the flush immediately, because the OS may
// kill the process without another chance — a backgrounded-but-alive app
// flushes again on the next interval.

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { NativeEventSubscription } from 'react-native';
import { api } from '../api/client';
import type { SignalType } from '../api/types';

const SIGNAL_FLUSH_MS = 10_000; // batch flush cadence (web parity)
const SIGNAL_BATCH_CAP = 100; // API schema max per batch

interface QueuedSignal {
  type: SignalType;
  at: string;
  detail?: Record<string, unknown>;
}

export function useSignals(
  token: string,
  active: boolean,
): {
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
    return () => clearInterval(timer);
  }, [active, flush]);

  // APP_BACKGROUND on app-state change — the TAB_SWITCH equivalent.
  useEffect(() => {
    if (!active) return;
    const sub: NativeEventSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        push('APP_BACKGROUND', { reason: 'app-state' });
        void flush(); // the process may be killed while backgrounded
      }
    });
    return () => sub.remove();
  }, [active, push, flush]);

  return { push, flush };
}

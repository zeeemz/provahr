// SwipeDeck — the D13/D14 Swipe-MCQ surface. The web portal renders SWIPE_MCQ
// as a flat like/dislike button list (apps/web TestFlow.tsx SwipeBody); the
// mobile app presents the same option set as a card deck with a native
// gesture: swipe RIGHT = LIKE, swipe LEFT = DISLIKE. Answers use the exact
// same wire shape (Record<optionId, 'LIKE' | 'DISLIKE'>), so the two portals
// are interchangeable against one session.
//
// Gesture implementation: PanResponder on the top card drives an Animated
// translateX/rotate; past a threshold (80px) the release commits the
// valuation and advances; below it, the card springs back. Tap-toggle
// fallback: Like/Dislike buttons under the deck (pressing the active one
// clears the valuation, matching web's toggle-to-skip semantics) — the deck
// is fully usable without gestures. Numbered chips give D14's per-question
// replay: jump back to any card and change the answer while the clock runs.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import type { GestureResponderEvent, PanResponderGestureState } from 'react-native';
import type { PresentedOption, SwipeValuation } from '../api/types';
import { COLORS } from '../ui';

const SWIPE_THRESHOLD = 80; // px past which a release commits
const FLING_TO = 600; // px the card animates to on commit
const CARD_HEIGHT = 220;

export function SwipeDeck({
  options,
  saved,
  onChange,
}: {
  options: PresentedOption[];
  saved: Record<string, SwipeValuation>;
  onChange: (content: Record<string, SwipeValuation>) => void;
}): JSX.Element {
  const [state, setState] = useState<Record<string, SwipeValuation>>(saved);
  const [cursor, setCursor] = useState(() => {
    const firstOpen = options.findIndex((o) => saved[o.id] === undefined);
    return firstOpen === -1 ? 0 : firstOpen;
  });

  const dx = useRef(new Animated.Value(0)).current;

  // Re-sync when the session view reloads (question stepper remounts by
  // order, but a same-order refresh keeps this component alive).
  useEffect(() => {
    setState(saved);
  }, [saved]);

  const current = options[cursor];
  const done = cursor >= options.length;

  const commit = useCallback(
    (optionId: string, v: SwipeValuation, advance: boolean): void => {
      const next = { ...state, [optionId]: v };
      setState(next);
      onChange(next);
      if (advance) setCursor((c) => Math.min(options.length, c + 1));
    },
    [state, onChange, options.length],
  );

  const clear = useCallback(
    (optionId: string): void => {
      const next = { ...state };
      delete next[optionId];
      setState(next);
      onChange(next);
    },
    [state, onChange],
  );

  // Gesture release → commit + fling the card off, then reset for the next.
  const releaseCard = useCallback(
    (gestureDx: number): void => {
      if (current === undefined) return;
      if (gestureDx >= SWIPE_THRESHOLD) {
        const id = current.id;
        Animated.timing(dx, {
          toValue: FLING_TO,
          duration: 160,
          useNativeDriver: true,
        }).start(() => {
          dx.setValue(0);
          commit(id, 'LIKE', true);
        });
      } else if (gestureDx <= -SWIPE_THRESHOLD) {
        const id = current.id;
        Animated.timing(dx, {
          toValue: -FLING_TO,
          duration: 160,
          useNativeDriver: true,
        }).start(() => {
          dx.setValue(0);
          commit(id, 'DISLIKE', true);
        });
      } else {
        Animated.spring(dx, { toValue: 0, useNativeDriver: true }).start();
      }
    },
    [current, dx, commit],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Horizontal-dominant moves only, so the deck never fights the
        // screen's vertical scroll.
        onMoveShouldSetPanResponder: (_e: GestureResponderEvent, g: PanResponderGestureState): boolean =>
          Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderMove: (_e: GestureResponderEvent, g: PanResponderGestureState): void => {
          dx.setValue(g.dx);
        },
        onPanResponderRelease: (_e: GestureResponderEvent, g: PanResponderGestureState): void => {
          releaseCard(g.dx);
        },
        onPanResponderTerminate: (): void => {
          Animated.spring(dx, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [dx, releaseCard],
  );

  const rotate = dx.interpolate({ inputRange: [-200, 0, 200], outputRange: ['-12deg', '0deg', '12deg'] });
  const likeOpacity = dx.interpolate({ inputRange: [30, 120], outputRange: [0, 1], extrapolate: 'clamp' });
  const dislikeOpacity = dx.interpolate({ inputRange: [-120, -30], outputRange: [1, 0], extrapolate: 'clamp' });

  /** Tap-toggle fallback: sets and advances; pressing the active one clears. */
  function choose(v: SwipeValuation): void {
    if (current === undefined) return;
    if (state[current.id] === v) clear(current.id);
    else commit(current.id, v, true);
  }

  return (
    <View>
      <Text style={styles.hint}>
        Swipe right to like, left to dislike — or use the buttons. You may leave statements unvalued and
        can change any answer via the numbered chips below.
      </Text>

      <View style={styles.deckArea}>
        {/* stack shadows behind the live card */}
        <View style={[styles.cardShadow, styles.shadowOne]} />
        <View style={[styles.cardShadow, styles.shadowTwo]} />

        {done || current === undefined ? (
          <View style={[styles.card, styles.doneCard]}>
            <Text style={styles.doneTitle}>All statements seen</Text>
            <Text style={styles.doneSub}>
              {options.filter((o) => state[o.id] !== undefined).length} of {options.length} valued. Tap a
              chip below to revisit and change any answer.
            </Text>
          </View>
        ) : (
          <Animated.View
            {...pan.panHandlers}
            style={[styles.card, { transform: [{ translateX: dx }, { rotate }] }]}
          >
            <Animated.Text style={[styles.stamp, styles.likeStamp, { opacity: likeOpacity }]}>
              LIKE
            </Animated.Text>
            <Animated.Text style={[styles.stamp, styles.dislikeStamp, { opacity: dislikeOpacity }]}>
              NOPE
            </Animated.Text>
            <Text style={styles.cardIndex}>
              Statement {cursor + 1} of {options.length}
            </Text>
            <Text style={styles.cardText}>{current.text}</Text>
            {state[current.id] !== undefined && (
              <Text style={state[current.id] === 'LIKE' ? styles.valuedLike : styles.valuedDislike}>
                You valued this: {state[current.id] === 'LIKE' ? 'Like' : 'Dislike'}
              </Text>
            )}
          </Animated.View>
        )}
      </View>

      <View style={styles.buttonRow}>
        <Pressable
          onPress={() => choose('DISLIKE')}
          style={({ pressed }) => [
            styles.roundButton,
            styles.dislikeButton,
            current !== undefined && state[current.id] === 'DISLIKE' ? null : styles.offButton,
            pressed ? { opacity: 0.7 } : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Dislike this statement"
        >
          <Text style={styles.dislikeText}>✕ Dislike</Text>
        </Pressable>
        <Pressable
          onPress={() => choose('LIKE')}
          style={({ pressed }) => [
            styles.roundButton,
            styles.likeButton,
            current !== undefined && state[current.id] === 'LIKE' ? null : styles.offButton,
            pressed ? { opacity: 0.7 } : null,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Like this statement"
        >
          <Text style={styles.likeText}>✓ Like</Text>
        </Pressable>
      </View>

      <View style={styles.navRow}>
        <Pressable
          disabled={cursor === 0}
          onPress={() => setCursor((c) => Math.max(0, c - 1))}
          style={({ pressed }) => [styles.chipNav, (cursor === 0 || pressed) ? { opacity: 0.4 } : null]}
          accessibilityRole="button"
          accessibilityLabel="Previous statement"
        >
          <Text style={styles.chipNavText}>‹ Prev</Text>
        </Pressable>
        <Pressable
          disabled={done}
          onPress={() => setCursor((c) => Math.min(options.length, c + 1))}
          style={({ pressed }) => [styles.chipNav, (done || pressed) ? { opacity: 0.4 } : null]}
          accessibilityRole="button"
          accessibilityLabel="Next statement"
        >
          <Text style={styles.chipNavText}>Next ›</Text>
        </Pressable>
      </View>

      <View style={styles.chipRow}>
        {options.map((o, i) => {
          const v = state[o.id];
          return (
            <Pressable
              key={o.id}
              onPress={() => setCursor(i)}
              style={[styles.chip, v === 'LIKE' ? styles.chipLike : v === 'DISLIKE' ? styles.chipDislike : null, i === cursor && !done ? styles.chipActive : null]}
              accessibilityRole="button"
              accessibilityLabel={`Statement ${i + 1}${v !== undefined ? `, valued ${v}` : ', unvalued'}`}
            >
              <Text style={[styles.chipText, v !== undefined ? { color: '#ffffff' } : null]}>{i + 1}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { color: COLORS.sub, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  deckArea: { height: CARD_HEIGHT + 16, justifyContent: 'center' },
  cardShadow: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: CARD_HEIGHT,
    borderRadius: 14,
    backgroundColor: '#eef2f7',
  },
  shadowOne: { top: 10 },
  shadowTwo: { top: 5 },
  card: {
    height: CARD_HEIGHT,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: '#ffffff',
    padding: 18,
    justifyContent: 'center',
  },
  doneCard: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' },
  doneTitle: { fontSize: 16, fontWeight: '700', color: COLORS.ink, marginBottom: 6 },
  doneSub: { color: COLORS.sub, fontSize: 13, textAlign: 'center' },
  cardIndex: { color: COLORS.sub, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  cardText: { color: COLORS.ink, fontSize: 17, lineHeight: 24, fontWeight: '500' },
  stamp: { position: 'absolute', top: 14, fontSize: 24, fontWeight: '800', letterSpacing: 2 },
  likeStamp: { right: 16, color: COLORS.green },
  dislikeStamp: { left: 16, color: COLORS.red },
  valuedLike: { color: COLORS.green, fontSize: 12, fontWeight: '700', marginTop: 10 },
  valuedDislike: { color: COLORS.red, fontSize: 12, fontWeight: '700', marginTop: 10 },
  buttonRow: { flexDirection: 'row', justifyContent: 'center', gap: 18, marginTop: 14 },
  roundButton: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 22, borderWidth: 2 },
  likeButton: { backgroundColor: COLORS.greenSoft, borderColor: COLORS.green },
  dislikeButton: { backgroundColor: COLORS.redSoft, borderColor: COLORS.red },
  offButton: { opacity: 0.45 },
  likeText: { color: COLORS.green, fontWeight: '700' },
  dislikeText: { color: COLORS.red, fontWeight: '700' },
  navRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  chipNav: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  chipNavText: { color: COLORS.blue, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  chipLike: { backgroundColor: COLORS.green, borderColor: COLORS.green },
  chipDislike: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  chipActive: { borderWidth: 2, borderColor: COLORS.ink },
  chipText: { fontSize: 13, fontWeight: '600', color: COLORS.sub },
});

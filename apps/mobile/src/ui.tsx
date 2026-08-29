// Shared React Native UI primitives — a hand-rolled subset of
// apps/web/src/components/ui.tsx (Card, Spinner, Badge, buttons) plus the
// input styling the apply form needs. Kept dependency-free: no UI kit.

import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import { errMessage } from './api/client';

export const COLORS = {
  ink: '#0f172a',
  sub: '#64748b',
  line: '#e2e8f0',
  bg: '#f6f8fb',
  card: '#ffffff',
  blue: '#2563eb',
  blueSoft: '#dbeafe',
  green: '#16a34a',
  greenSoft: '#dcfce7',
  red: '#dc2626',
  redSoft: '#fee2e2',
  amber: '#b45309',
  amberSoft: '#fef3c7',
};

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }): JSX.Element {
  return <View style={[styles.card as ViewStyle, style]}>{children}</View>;
}

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <View style={styles.spinner}>
      <ActivityIndicator size="large" color={COLORS.blue} />
      {label !== undefined && <Text style={styles.sub}>{label}</Text>}
    </View>
  );
}

type BadgeTone = 'blue' | 'outline' | 'green' | 'red' | 'amber';

const BADGE_TEXT: Record<BadgeTone, string> = {
  blue: '#1d4ed8',
  outline: COLORS.sub,
  green: COLORS.green,
  red: COLORS.red,
  amber: COLORS.amber,
};

export function Badge({ text, tone = 'blue' }: { text: string; tone?: BadgeTone }): JSX.Element {
  const view: StyleProp<ViewStyle> =
    tone === 'outline'
      ? styles.badgeOutline
      : { backgroundColor: tone === 'green' ? COLORS.greenSoft : tone === 'red' ? COLORS.redSoft : tone === 'amber' ? COLORS.amberSoft : COLORS.blueSoft };
  const textStyle: StyleProp<TextStyle> = { color: BADGE_TEXT[tone] };
  return (
    <View style={[styles.badge as ViewStyle, view]}>
      <Text style={[styles.badgeText as TextStyle, textStyle]}>{text}</Text>
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled,
  tone = 'blue',
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'blue' | 'green' | 'red' | 'ghost';
}): JSX.Element {
  const bg: string =
    tone === 'green' ? COLORS.green : tone === 'red' ? COLORS.red : tone === 'ghost' ? '#e2e8f0' : COLORS.blue;
  const fg = tone === 'ghost' ? COLORS.ink : '#ffffff';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button as ViewStyle,
        { backgroundColor: bg, opacity: disabled === true || pressed ? 0.6 : 1 },
      ]}
      accessibilityRole="button"
    >
      <Text style={[styles.buttonText as TextStyle, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorBox({ err }: { err: unknown }): JSX.Element {
  return (
    <Card style={styles.errorCard}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.sub}>{errMessage(err)}</Text>
    </Card>
  );
}

export function FieldLabel({ children }: { children: ReactNode }): JSX.Element {
  return <Text style={styles.fieldLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    padding: 16,
    marginBottom: 12,
  },
  spinner: { gap: 10, padding: 24, alignItems: 'center', justifyContent: 'center' },
  sub: { color: COLORS.sub, fontSize: 14, lineHeight: 20 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  badgeOutline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: COLORS.line },
  badgeText: { fontSize: 12, fontWeight: '600' },
  button: { borderRadius: 10, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  buttonText: { fontSize: 15, fontWeight: '600' },
  errorCard: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  errorTitle: { color: COLORS.red, fontSize: 16, fontWeight: '700', marginBottom: 4 },
  fieldLabel: { color: COLORS.ink, fontWeight: '600', fontSize: 13, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 8,
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: COLORS.ink,
  },
});

export const inputStyle: StyleProp<TextStyle> = styles.input;
export const inputProps = {
  style: inputStyle,
  placeholderTextColor: '#94a3b8',
  autoCorrect: false,
} as const;

// TextInput is re-exported for form screens that compose inputProps with
// format-specific overrides (multiline, keyboard types, …).
export { TextInput };

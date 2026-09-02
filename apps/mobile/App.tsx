// ProvaHR candidate app — PLAN.md Phase 6 / D13. React Native + Expo +
// TypeScript, same API contract as the web portal (apps/web).
//
// Navigation is a deliberately tiny in-repo stack (board → job detail/apply →
// test flow) instead of react-navigation: three screens deep, no params
// beyond an id/token, and it keeps the native dependency surface minimal.

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { JobBoardScreen } from './src/screens/JobBoardScreen';
import { JobDetailScreen } from './src/screens/JobDetailScreen';
import { TestFlowScreen } from './src/screens/TestFlowScreen';
import { COLORS } from './src/ui';

type Route =
  | { name: 'board' }
  | { name: 'job'; jobId: string }
  | { name: 'test'; token: string };

export default function App(): JSX.Element {
  const [stack, setStack] = useState<Route[]>([{ name: 'board' }]);
  const top = stack[stack.length - 1];

  const push = useCallback((route: Route) => setStack((s) => [...s, route]), []);
  const pop = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);

  const goBoard = useCallback(() => setStack([{ name: 'board' }]), []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        {stack.length > 1 && top.name !== 'test' ? (
          <Pressable onPress={pop} accessibilityRole="button" accessibilityLabel="Go back" style={styles.back}>
            <Text style={styles.backText}>←</Text>
          </Pressable>
        ) : null}
        <Text style={styles.logo}>
          Prova
          <Text style={styles.logoAccent}>HR</Text>
        </Text>
        <Text style={styles.tag}>Prove your skill</Text>
      </View>

      <View style={styles.body}>
        {top.name === 'board' && (
          <JobBoardScreen
            onOpenJob={(jobId) => push({ name: 'job', jobId })}
            onOpenTest={(token) => push({ name: 'test', token })}
          />
        )}
        {top.name === 'job' && (
          <JobDetailScreen jobId={top.jobId} onBack={pop} onStartTest={(token) => push({ name: 'test', token })} />
        )}
        {top.name === 'test' && <TestFlowScreen token={top.token} onExit={goBoard} />}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: COLORS.card,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  back: { paddingVertical: 4, paddingHorizontal: 8 },
  backText: { fontSize: 20, color: COLORS.blue, fontWeight: '700' },
  logo: { fontSize: 20, fontWeight: '900', color: COLORS.ink },
  logoAccent: { color: COLORS.blue, fontWeight: '900' },
  tag: { color: COLORS.sub, fontSize: 12, marginLeft: 'auto' },
  body: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
});

// Public job board — GET /api/public/jobs (mobile mirror of
// apps/web/src/public/JobBoard.tsx). The list endpoint accepts the same
// q/roleFamily/workMode filters as web; the app keeps just the search box
// and does pull-to-refresh.

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from 'react-native';
import { api } from '../api/client';
import type { PublicJob } from '../api/types';
import { Badge, Card, COLORS, ErrorBox, PrimaryButton, Spinner, inputProps } from '../ui';
import { humanize, salaryLine } from '../util';

export function JobBoardScreen({
  onOpenJob,
  onOpenTest,
}: {
  onOpenJob: (jobId: string) => void;
  onOpenTest: (token: string) => void;
}): JSX.Element {
  const [jobs, setJobs] = useState<PublicJob[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [token, setToken] = useState('');
  const [tokenOpen, setTokenOpen] = useState(false);

  const load = useCallback(async (q: string): Promise<void> => {
    try {
      const res = await api.get<{ jobs: PublicJob[] }>(`/public/jobs${q.length > 0 ? `?q=${encodeURIComponent(q)}` : ''}`);
      setJobs(res.jobs);
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  function onSubmitSearch(): void {
    void load(search.trim());
  }

  function onRefresh(): void {
    setRefreshing(true);
    void load(search.trim()).then(() => setRefreshing(false));
  }

  if (error !== null) {
    return <ErrorBox err={error} />;
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.blue} />}
      keyboardShouldPersistTaps="handled"
    >
      <TextInput
        {...inputProps}
        value={search}
        onChangeText={setSearch}
        onSubmitEditing={onSubmitSearch}
        placeholder="Search roles…"
        returnKeyType="search"
      />

      {jobs === null ? (
        <Spinner label="Loading open roles…" />
      ) : jobs.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No open roles right now</Text>
          <Text style={styles.sub}>Pull to refresh, or clear the search box.</Text>
        </Card>
      ) : (
        jobs.map((job) => (
          <Pressable key={job.id} onPress={() => onOpenJob(job.id)} accessibilityRole="button" accessibilityLabel={`Open ${job.title}`}>
            <Card style={styles.jobCard}>
              <View style={styles.jobHead}>
                <Text style={styles.jobTitle} numberOfLines={2}>
                  {job.title}
                </Text>
                {job.testRequired ? <Badge text="Skill test" /> : <Badge text="No test" tone="outline" />}
              </View>
              <Text style={styles.sub}>
                {job.department} · {job.location} · {humanize(job.workMode)} · {humanize(job.employmentType)}
              </Text>
              {salaryLine(job) !== null && <Text style={styles.sub}>{salaryLine(job)}</Text>}
            </Card>
          </Pressable>
        ))
      )}

      <Pressable onPress={() => setTokenOpen((o) => !o)} accessibilityRole="button">
        <Text style={styles.tokenToggle}>Already applied? Enter your test code</Text>
      </Pressable>
      {tokenOpen && (
        <Card>
          <Text style={styles.sub}>
            Paste the one-time test code from your application confirmation. The code is single-use.
          </Text>
          <TextInput
            {...inputProps}
            value={token}
            onChangeText={setToken}
            placeholder="e.g. 7f3a…"
            autoCapitalize="none"
            style={[inputProps.style, styles.tokenInput]}
          />
          <PrimaryButton label="Open my test" onPress={() => token.trim().length > 0 && onOpenTest(token.trim())} />
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  jobCard: { marginBottom: 10 },
  jobHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 },
  jobTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: COLORS.ink },
  sub: { color: COLORS.sub, fontSize: 13, lineHeight: 19, marginTop: 2 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: COLORS.ink, marginBottom: 4 },
  tokenToggle: { color: COLORS.blue, fontWeight: '600', fontSize: 14, textAlign: 'center', marginTop: 18, marginBottom: 8 },
  tokenInput: { marginTop: 8, marginBottom: 10 },
});

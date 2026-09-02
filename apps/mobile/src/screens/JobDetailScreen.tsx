// Public job detail + apply form — GET /api/public/jobs/:id, POST .../apply
// (mobile mirror of apps/web/src/public/JobDetail.tsx).
//
// The apply response carries the ONE-TIME test link token — the only time the
// plain token ever leaves the API. The success screen treats it accordingly:
// prominent selectable token, copy via expo-clipboard, expiry, and a direct
// start action that navigates straight into the in-app test flow. There is no
// "resend" — losing it means contacting the employer.

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { api, errMessage, isNotFound } from '../api/client';
import type { ApplyInput, ApplyResponse, PublicJob } from '../api/types';
import { Badge, Card, COLORS, ErrorBox, FieldLabel, PrimaryButton, Spinner, inputProps } from '../ui';
import { fmtDateTime, humanize, salaryLine } from '../util';

interface FormState {
  name: string;
  email: string;
  phone: string;
  resumeUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  coverLetter: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  email: '',
  phone: '',
  resumeUrl: '',
  linkedinUrl: '',
  githubUrl: '',
  coverLetter: '',
};

export function JobDetailScreen({
  jobId,
  onBack,
  onStartTest,
}: {
  jobId: string;
  onBack: () => void;
  onStartTest: (token: string) => void;
}): JSX.Element {
  const [job, setJob] = useState<PublicJob | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ job: PublicJob }>(`/public/jobs/${jobId}`)
      .then((res) => {
        if (!cancelled) setJob(res.job);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loadError !== null) {
    return isNotFound(loadError) ? (
      <Card>
        <Text style={styles.h2}>Role not found</Text>
        <Text style={styles.sub}>This role is not open or does not exist.</Text>
        <PrimaryButton label="← Back to the board" tone="ghost" onPress={onBack} />
      </Card>
    ) : (
      <ErrorBox err={loadError} />
    );
  }
  if (job === null) {
    return <Spinner />;
  }

  const salary = salaryLine(job);

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Card>
        <View style={styles.jobHead}>
          <Text style={styles.h1}>{job.title}</Text>
          {job.testRequired ? <Badge text="Skill test required" /> : <Badge text="No skill test" tone="outline" />}
        </View>
        <Text style={styles.sub}>
          {job.department} · {job.location} · {humanize(job.workMode)} · {humanize(job.employmentType)}
          {salary !== null ? `\n${salary}` : ''}
        </Text>
        <Text style={styles.section}>About the role</Text>
        <Text style={styles.description}>{job.description}</Text>
      </Card>
      <ApplyForm jobId={job.id} testRequired={job.testRequired} onStartTest={onStartTest} />
    </ScrollView>
  );
}

function ApplyForm({
  jobId,
  testRequired,
  onStartTest,
}: {
  jobId: string;
  testRequired: boolean;
  onStartTest: (token: string) => void;
}): JSX.Element {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [result, setResult] = useState<ApplyResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copyToken(token: string): Promise<void> {
    try {
      await Clipboard.setStringAsync(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  }

  async function submit(): Promise<void> {
    setSubmitting(true);
    setError(null);
    const payload: ApplyInput = {
      name: form.name.trim(),
      email: form.email.trim(),
    };
    if (form.phone.trim()) payload.phone = form.phone.trim();
    if (form.resumeUrl.trim()) payload.resumeUrl = form.resumeUrl.trim();
    if (form.linkedinUrl.trim()) payload.linkedinUrl = form.linkedinUrl.trim();
    if (form.githubUrl.trim()) payload.githubUrl = form.githubUrl.trim();
    if (form.coverLetter.trim()) payload.coverLetter = form.coverLetter.trim();
    try {
      const res = await api.post<ApplyResponse>(`/public/jobs/${jobId}/apply`, payload);
      setResult(res);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (result !== null) {
    return (
      <Card>
        <Text style={styles.h2}>Application received</Text>
        {result.testLink !== null ? (
          <>
            <Text style={styles.sub}>
              This role includes a skill test. Your <Text style={styles.bold}>one-time test code</Text> is
              below — it is shown <Text style={styles.bold}>only this once</Text> and cannot be reissued, so
              save it now.
            </Text>
            <View style={styles.tokenBox}>
              <View style={styles.tokenHead}>
                <Text style={styles.tokenLabel}>Test code (valid until {fmtDateTime(result.testLink.expiresAt)})</Text>
                <Pressable onPress={() => void copyToken(result.testLink?.token ?? '')} accessibilityRole="button" accessibilityLabel="Copy test code">
                  <Text style={styles.copyButton}>{copied ? 'Copied ✓' : 'Copy'}</Text>
                </Pressable>
              </View>
              <Text selectable style={styles.token}>
                {result.testLink.token}
              </Text>
            </View>
            <View style={{ marginTop: 14 }}>
              <PrimaryButton label="Start the test now" onPress={() => onStartTest(result.testLink?.token ?? '')} />
            </View>
            <Text style={styles.hint}>
              Single use · expires {fmtDateTime(result.testLink.expiresAt)} · the clock never pauses once you
              start. Prefer to take it later? Copy the code first — after leaving this page it cannot be
              recovered.
            </Text>
          </>
        ) : (
          <Text style={styles.sub}>
            Your application has been recorded. This role does not require a skill test{' '}
            {result.testLinkReason === 'NO_POOL' ? '(no active test)' : ''} — the hiring team will review and
            get back to you.
          </Text>
        )}
      </Card>
    );
  }

  const set = (key: keyof FormState) => (text: string) => setForm((f) => ({ ...f, [key]: text }));
  const nameOk = form.name.trim().length >= 2;
  const emailOk = /.+@.+\..+/.test(form.email.trim());

  return (
    <Card>
      <Text style={styles.h2}>Apply{testRequired ? ' + take the skill test' : ''}</Text>
      {testRequired && (
        <Text style={styles.sub}>
          Applying issues your one-time test code immediately. The test is monitored (app-background, paste,
          timing signals — no camera) and time-boxed.
        </Text>
      )}

      <FieldLabel>Full name</FieldLabel>
      <TextInput {...inputProps} value={form.name} onChangeText={set('name')} maxLength={120} autoCapitalize="words" />

      <FieldLabel>Email</FieldLabel>
      <TextInput {...inputProps} value={form.email} onChangeText={set('email')} maxLength={200} keyboardType="email-address" autoCapitalize="none" />

      <FieldLabel>Phone (optional)</FieldLabel>
      <TextInput {...inputProps} value={form.phone} onChangeText={set('phone')} maxLength={30} keyboardType="phone-pad" />

      <FieldLabel>Resume / portfolio URL (optional)</FieldLabel>
      <TextInput {...inputProps} value={form.resumeUrl} onChangeText={set('resumeUrl')} placeholder="https://…" autoCapitalize="none" />

      <FieldLabel>LinkedIn URL (optional)</FieldLabel>
      <TextInput {...inputProps} value={form.linkedinUrl} onChangeText={set('linkedinUrl')} placeholder="https://linkedin.com/in/…" autoCapitalize="none" />

      <FieldLabel>GitHub URL (optional)</FieldLabel>
      <TextInput {...inputProps} value={form.githubUrl} onChangeText={set('githubUrl')} placeholder="https://github.com/…" autoCapitalize="none" />

      <FieldLabel>Why this role? (optional, max 5000 chars)</FieldLabel>
      <TextInput
        {...inputProps}
        value={form.coverLetter}
        onChangeText={set('coverLetter')}
        maxLength={5000}
        multiline
        style={[inputProps.style, styles.cover]}
        textAlignVertical="top"
      />

      {error !== null && <Text style={styles.formError}>{error}</Text>}
      <View style={{ marginTop: 14 }}>
        <PrimaryButton
          label={submitting ? 'Submitting…' : 'Submit application'}
          onPress={() => void submit()}
          disabled={submitting || !nameOk || !emailOk}
        />
      </View>
      <Text style={styles.hint}>No account needed. Applying to this role is one-time only.</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 40 },
  h1: { flex: 1, fontSize: 22, fontWeight: '800', color: COLORS.ink },
  h2: { fontSize: 18, fontWeight: '700', color: COLORS.ink, marginBottom: 6 },
  section: { fontSize: 15, fontWeight: '700', color: COLORS.ink, marginTop: 14, marginBottom: 4 },
  sub: { color: COLORS.sub, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '700', color: COLORS.ink },
  description: { color: '#334155', fontSize: 14, lineHeight: 21 },
  jobHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 },
  tokenBox: {
    borderWidth: 1,
    borderColor: COLORS.blue,
    backgroundColor: '#eff6ff',
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  tokenHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  tokenLabel: { flex: 1, fontSize: 12, color: '#1d4ed8', fontWeight: '600' },
  copyButton: { color: COLORS.blue, fontWeight: '700', fontSize: 13 },
  token: { fontFamily: 'monospace', fontSize: 15, color: COLORS.ink, marginTop: 8 },
  hint: { color: COLORS.sub, fontSize: 12, lineHeight: 17, marginTop: 10 },
  formError: { color: COLORS.red, fontSize: 13, marginTop: 10 },
  cover: { minHeight: 100, paddingTop: 10 },
});

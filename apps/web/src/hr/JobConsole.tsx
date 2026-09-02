// Job console — the PLAN §4 loop as one page per role:
//   1. JD (poll GET /jobs/:id/jd while drafting → edit PATCH → approve)
//   2. Blueprint editor (PUT /jobs/:id/blueprint) — topics, format counts, time limit
//   3. Sample preview (POST .../blueprint/samples → poll GET until generated)
//   4. Sealed pool (POST .../pool/seal → poll GET /jobs/:id/pool until active)
//   5. Publish (POST /jobs/:id/status { OPEN })
//
// All of these are recruiter+ on the API; interviewers get a clean notice.
// The sealed pool surfaces COUNTS ONLY — no endpoint anywhere returns items.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, errMessage } from '../api/client';
import type {
  BlueprintSection,
  BlueprintStatusView,
  JobPromptView,
  JdDraft,
  JdView,
  Job,
  PoolStatusView,
  QuestionFormat,
  SampleItem,
} from '../api/types';
import { isRecruiterPlus, useAuth } from '../auth/AuthContext';
import {
  ApiErrorScreen,
  ErrorBox,
  DIFFICULTY_MIXES,
  QUESTION_FORMAT_LIST,
  ROLE_FAMILIES,
  Spinner,
  EMPLOYMENT_TYPES,
  WORK_MODES,
  fmtDateTime,
  humanize,
  statusBadgeClass,
} from '../components/ui';

const POLL_MS = 3000;

export default function JobConsole(): JSX.Element {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<unknown>(null);

  const loadJob = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<{ job: Job }>(`/jobs/${id}`);
      setJob(res.job);
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    void loadJob();
  }, [loadJob]);

  if (error !== null) {
    return (
      <main className="page">
        <ApiErrorScreen err={error} />
      </main>
    );
  }
  if (job === null) {
    return (
      <main className="page">
        <Spinner />
      </main>
    );
  }

  const jdApproved = job.jdStatus === 'JD_APPROVED';
  const steps = [
    { label: '1 · JD', done: jdApproved },
    { label: '2 · Blueprint', done: false },
    { label: '3 · Samples', done: false },
    { label: '4 · Pool', done: false },
    { label: '5 · Publish', done: job.status === 'OPEN' },
  ];

  return (
    <main className="page wide">
      <p>
        <Link to="/app/jobs">← All roles</Link>
      </p>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{job.title}</h1>
        <span className={statusBadgeClass(job.status)}>{humanize(job.status)}</span>
      </div>
      <p className="sub">
        {job.department} · {job.location} · {humanize(job.workMode)} ·{' '}
        {job.jdStatus ? `JD: ${humanize(job.jdStatus)} · ` : ''}
        {job._count?.applications ?? 0} application(s)
      </p>

      <div className="stepper">
        {steps.map((s) => (
          <span key={s.label} className={`step-chip${s.done ? ' done' : ''}`}>
            {s.label}
          </span>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 16 }}>
        <Link className="button secondary" to={`/app/jobs/${job.id}/pipeline`} style={{ background: '#fff', color: 'var(--text)' }}>
          Pipeline & applications →
        </Link>
        {job.status === 'OPEN' && (
          <Link className="button secondary" to={`/jobs/${job.id}`} style={{ background: '#fff', color: 'var(--text)' }}>
            View public page
          </Link>
        )}
      </div>

      {isRecruiterPlus(user) ? (
        <>
          <JdStep jobId={job.id} onApproved={() => void loadJob()} />
          <RolePromptCard jobId={job.id} />
          <BlueprintStep jobId={job.id} jdApproved={jdApproved} />
          <SamplesStep jobId={job.id} />
          <PoolStep jobId={job.id} />
          <PublishStep job={job} onChanged={() => void loadJob()} />
        </>
      ) : (
        <div className="card">
          <h2>Read-only view</h2>
          <p>
            The wizard (JD editing, blueprint, pool, publishing) is restricted to recruiters and
            admins. You can still review the{' '}
            <Link to={`/app/jobs/${job.id}/pipeline`}>pipeline</Link>.
          </p>
        </div>
      )}
    </main>
  );
}

// ─── Step 1: JD ───────────────────────────────────────────────────────────────

function JdStep({ jobId, onApproved }: { jobId: string; onApproved: () => void }): JSX.Element {
  const [jd, setJd] = useState<JdView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<JdView | null> => {
    try {
      const res = await api.get<{ jd: JdView }>(`/jobs/${jobId}/jd`);
      setJd(res.jd);
      setError(null);
      return res.jd;
    } catch (err) {
      setError(err);
      return null;
    }
  }, [jobId]);

  useEffect(() => {
    let cancelled = false;
    const run = (): void => {
      void load().then((view) => {
        if (cancelled || view === null) return;
        if (view.jdStatus === 'JD_DRAFTING') timerRef.current = setTimeout(run, POLL_MS);
      });
    };
    run();
    return () => {
      cancelled = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [load]);

  if (error !== null) return <ApiErrorScreen err={error} />;
  if (jd === null) return <Spinner />;

  return (
    <div className="card">
      <h2>1 · Job description</h2>

      <div className="row">
        <span className={jd.jdStatus === 'JD_APPROVED' ? 'badge green' : 'badge blue'}>
          {humanize(jd.jdStatus)}
        </span>
        {jd.urls.length > 0 && <span className="badge outline">{jd.urls.length} source URL(s)</span>}
        {jd.screenshotCount > 0 && <span className="badge outline">{jd.screenshotCount} screenshot(s)</span>}
      </div>

      {jd.jdStatus === 'JD_DRAFTING' && (
        <>
          <p className="sub">The AI is drafting from your material — this page updates automatically.</p>
          <p className="busy"><span className="spin" /> Drafting…</p>
        </>
      )}
      {jd.error !== null && <p className="form-error">Last generation failure: {jd.error}</p>}
      {jd.fetchedExcerpt !== null && (
        <details>
          <summary className="hint" style={{ cursor: 'pointer' }}>Fetched source text (best-effort)</summary>
          <pre style={{ maxHeight: 160 }}>{jd.fetchedExcerpt}</pre>
        </details>
      )}

      {jd.jdStatus === 'JD_REVIEW' && jd.draft !== null && (
        <DraftEditor
          jobId={jobId}
          initial={jd.draft}
          onApproved={() => {
            void load(); // refresh this step (JD_APPROVED) alongside the parent job row
            onApproved(); // unlocks the blueprint step
          }}
        />
      )}

      {jd.jdStatus === 'JD_APPROVED' && (
        <p className="form-ok" style={{ marginBottom: 0 }}>
          Approved — the blueprint step below is unlocked.
        </p>
      )}
    </div>
  );
}

function DraftEditor({ jobId, initial, onApproved }: { jobId: string; initial: JdDraft; onApproved: () => void }): JSX.Element {
  const [draft, setDraft] = useState<JdDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof JdDraft>(key: K, value: JdDraft[K]): void => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Send only filled fields — nulls mean "material did not support this".
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(draft)) {
        if (typeof value === 'string' && value.trim() !== '') patch[key] = value.trim();
      }
      await api.patch(`/jobs/${jobId}/jd`, patch);
      setSaved(true);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function approve(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/jobs/${jobId}/jd/approve`, {});
      onApproved();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const text = (key: keyof JdDraft, label: string, opts?: { area?: boolean; hint?: string }) => (
    <>
      <label className="field" htmlFor={`jd-${key}`}>{label}</label>
      {opts?.area ? (
        <textarea
          id={`jd-${key}`}
          value={(draft[key] as string | null | undefined) ?? ''}
          onChange={(e) => set(key, e.target.value as never)}
          style={{ minHeight: 200 }}
        />
      ) : (
        <input
          id={`jd-${key}`}
          type="text"
          value={(draft[key] as string | null | undefined) ?? ''}
          onChange={(e) => set(key, e.target.value as never)}
        />
      )}
      {opts?.hint !== undefined && <p className="hint">{opts.hint}</p>}
    </>
  );

  const select = (key: keyof JdDraft, label: string, options: readonly string[]) => (
    <>
      <label className="field" htmlFor={`jd-${key}`}>{label}</label>
      <select
        id={`jd-${key}`}
        value={(draft[key] as string | null | undefined) ?? ''}
        onChange={(e) => set(key, e.target.value as never)}
      >
        <option value="">(not set)</option>
        {options.map((o) => (
          <option key={o} value={o}>{humanize(o)}</option>
        ))}
      </select>
    </>
  );

  return (
    <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 6 }}>
      <h3>Review & edit the draft</h3>
      {text('title', 'Title')}
      {text('department', 'Department')}
      {select('roleFamily', 'Role family', ROLE_FAMILIES)}
      {text('location', 'Location')}
      {select('workMode', 'Work mode', WORK_MODES)}
      {select('employmentType', 'Employment type', EMPLOYMENT_TYPES)}
      {text('summary', 'Summary (optional)', { area: true })}
      {text('description', 'Description (min 200 chars)', { area: true })}
      {error !== null && <p className="form-error">{error}</p>}
      <div className="row" style={{ marginTop: 16 }}>
        <button type="button" className="secondary" disabled={busy} onClick={() => void save()}>
          Save draft
        </button>
        <button type="button" disabled={busy} onClick={() => void approve()}>
          Approve JD
        </button>
        {saved && <span className="form-ok" style={{ margin: 0, padding: '4px 10px' }}>Saved ✓</span>}
      </div>
      <p className="hint">Approval copies the draft onto the role — the blueprint unlocks after.</p>
    </div>
  );
}

// ─── AI prompts (two-tier, founder requirement) ───────────────────────────────

/**
 * The job-specific prompt tier, plus the platform MAIN prompt rendered
 * read-only (company users can see it; only the super admin can edit it).
 * Set before generating the JD / samples / pool — it rides every AI request
 * made for this role.
 */
function RolePromptCard({ jobId }: { jobId: string }): JSX.Element {
  const [mainPrompt, setMainPrompt] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get<JobPromptView>(`/jobs/${jobId}/prompt`)
      .then((res) => {
        if (!cancelled) {
          setMainPrompt(res.mainPrompt);
          setPrompt(res.jobPrompt ?? '');
          setLoaded(true);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  async function save(): Promise<void> {
    setBusy(true);
    setFormError(null);
    setSaved(false);
    try {
      // Empty editor = no overlay: clear with null rather than saving ''.
      const body = prompt.trim() === '' ? { jobPrompt: null } : { jobPrompt: prompt };
      const res = await api.put<{ jobPrompt: string | null }>(`/jobs/${jobId}/prompt`, body);
      setPrompt(res.jobPrompt ?? '');
      setSaved(true);
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>AI prompts</h2>
      {error !== null && <ErrorBox err={error} note="Could not load the prompts" />}
      {error === null && !loaded && <Spinner label="Loading prompts…" />}
      {loaded && (
        <>
          <details style={{ marginBottom: 12 }}>
            <summary className="hint" style={{ cursor: 'pointer' }}>Platform rules (read-only)</summary>
            {mainPrompt !== null && mainPrompt.trim() !== '' ? (
              <pre style={{ maxHeight: 200, whiteSpace: 'pre-wrap' }}>{mainPrompt}</pre>
            ) : (
              <p className="muted" style={{ margin: '8px 0 0' }}>
                No platform rules set — the super admin can add them in the platform console.
              </p>
            )}
          </details>

          <label className="field" htmlFor="job-prompt">Role-specific prompt</label>
          <textarea
            id="job-prompt"
            value={prompt}
            maxLength={8000}
            style={{ minHeight: 120 }}
            onChange={(e) => {
              setPrompt(e.target.value);
              setSaved(false);
            }}
          />
          <p className="hint">
            Appended to every AI request for this role — tone, emphasis, must-cover topics.
          </p>
          {formError !== null && <p className="form-error">{formError}</p>}
          {saved && <p className="form-ok" style={{ marginTop: 0 }}>Saved ✓</p>}
          <p>
            <button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save role prompt'}
            </button>
          </p>
        </>
      )}
    </div>
  );
}

// ─── Step 2: Blueprint ────────────────────────────────────────────────────────

interface SectionDraft {
  title: string;
  topics: string; // comma-separated while editing
  counts: Record<QuestionFormat, number>;
  difficultyMix: string;
}

function emptySection(): SectionDraft {
  return { title: '', topics: '', counts: { SWIPE_MCQ: 1, MCQ: 0, WRITTEN: 0, CODE: 0 }, difficultyMix: 'BALANCED' };
}

function toDraft(sections: BlueprintSection[]): SectionDraft[] {
  return sections.map((s) => ({
    title: s.title ?? '',
    topics: s.topics.join(', '),
    counts: {
      SWIPE_MCQ: s.formats.SWIPE_MCQ ?? 0,
      MCQ: s.formats.MCQ ?? 0,
      WRITTEN: s.formats.WRITTEN ?? 0,
      CODE: s.formats.CODE ?? 0,
    },
    difficultyMix: s.difficultyMix ?? 'BALANCED',
  }));
}

function toSections(drafts: SectionDraft[]): BlueprintSection[] {
  return drafts.map((d) => ({
    ...(d.title.trim() !== '' ? { title: d.title.trim() } : {}),
    topics: d.topics.split(',').map((t) => t.trim()).filter(Boolean),
    formats: Object.fromEntries(
      QUESTION_FORMAT_LIST.map((f) => [f, d.counts[f]]).filter(([, n]) => (n as number) > 0),
    ) as Partial<Record<QuestionFormat, number>>,
    ...(d.difficultyMix !== '' ? { difficultyMix: d.difficultyMix as BlueprintSection['difficultyMix'] } : {}),
  }));
}

function BlueprintStep({ jobId, jdApproved }: { jobId: string; jdApproved: boolean }): JSX.Element {
  const [view, setView] = useState<BlueprintStatusView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sections, setSections] = useState<SectionDraft[]>([emptySection()]);
  const [timeLimitMin, setTimeLimitMin] = useState(30);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await api.get<BlueprintStatusView>(`/jobs/${jobId}/blueprint`);
      setView(res);
      if (res.blueprint !== null) {
        setSections(toDraft(res.blueprint.sections));
        setTimeLimitMin(res.blueprint.timeLimitMin);
      }
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [jobId]);

  useEffect(() => {
    if (jdApproved) void load();
  }, [jdApproved, load]);

  if (!jdApproved) {
    return (
      <div className="card">
        <h2>2 · Test blueprint</h2>
        <p className="sub mt0">Unlocks once the JD is approved.</p>
      </div>
    );
  }
  if (error !== null) return <ApiErrorScreen err={error} />;
  if (view === null) return <Spinner />;

  const poolSealed = view.pool.hasActivePool;

  async function save(): Promise<void> {
    setBusy(true);
    setFormError(null);
    setSavedNote(null);
    const parsed = toSections(sections);
    if (parsed.length < 1 || parsed.length > 6) {
      setFormError('Between 1 and 6 sections.');
      setBusy(false);
      return;
    }
    if (parsed.some((s) => s.topics.length < 1 || s.topics.length > 5)) {
      setFormError('Each section needs 1–5 topics (comma-separated).');
      setBusy(false);
      return;
    }
    if (parsed.some((s) => !QUESTION_FORMAT_LIST.some((f) => (s.formats[f] ?? 0) > 0))) {
      setFormError('Each section needs at least one format with a count of 1 or more.');
      setBusy(false);
      return;
    }
    if (timeLimitMin < 10 || timeLimitMin > 180) {
      setFormError('Time limit must be 10–180 minutes.');
      setBusy(false);
      return;
    }
    try {
      await api.put(`/jobs/${jobId}/blueprint`, { sections: parsed, timeLimitMin });
      setSavedNote('Blueprint saved. The sealed pool is ≥6× the draw size — regenerate samples to preview the new shape.');
      await load();
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const updateSection = (i: number, patch: Partial<SectionDraft>): void => {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setSavedNote(null);
  };

  const totalDraw = sections.reduce(
    (sum, s) => sum + QUESTION_FORMAT_LIST.reduce((f2, f) => f2 + (s.counts[f] || 0), 0),
    0,
  );

  return (
    <div className="card">
      <h2>2 · Test blueprint</h2>
      <p className="sub">
        What the test covers — topics, format mix, difficulty, time. It contains zero questions:
        the pool is generated and sealed server-side; nobody (you included) can enumerate it.
      </p>

      {poolSealed && (
        <p className="form-error">
          A pool is sealed for blueprint v{view.pool.poolVersion} ({view.pool.itemCount} items) —
          editing is frozen until you <strong>re-seal</strong> in step 4.
        </p>
      )}
      {view.blueprint !== null && !poolSealed && (
        <p className="hint">
          Current blueprint: v{view.blueprint.version} · {totalDraw} questions per session ·{' '}
          {view.blueprint.timeLimitMin} min
        </p>
      )}

      {sections.map((section, i) => (
        <div key={i} className="section-edit">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>Section {i + 1}</strong>
            {sections.length > 1 && (
              <button
                type="button"
                className="small danger"
                onClick={() => setSections((prev) => prev.filter((_, idx) => idx !== i))}
              >
                Remove
              </button>
            )}
          </div>
          <label className="field" htmlFor={`sec-title-${i}`}>Title (optional)</label>
          <input id={`sec-title-${i}`} type="text" maxLength={120} value={section.title}
            onChange={(e) => updateSection(i, { title: e.target.value })} />
          <label className="field" htmlFor={`sec-topics-${i}`}>Topics (1–5, comma-separated)</label>
          <input id={`sec-topics-${i}`} type="text" placeholder="kubernetes, incident response, observability"
            value={section.topics} onChange={(e) => updateSection(i, { topics: e.target.value })} />
          <label className="field">Questions per format (what a session draws)</label>
          <div className="fmt-row">
            {QUESTION_FORMAT_LIST.map((f) => (
              <label key={f} className="hint" style={{ marginTop: 0, fontWeight: 400 }}>
                <span style={{ display: 'block', marginBottom: 2 }}>{humanize(f)}</span>
                <input type="number" min={0} max={10} value={section.counts[f]}
                  onChange={(e) =>
                    updateSection(i, { counts: { ...section.counts, [f]: Math.max(0, Number(e.target.value) || 0) } })
                  } />
              </label>
            ))}
          </div>
          <label className="field" htmlFor={`sec-mix-${i}`}>Difficulty mix</label>
          <select id={`sec-mix-${i}`} value={section.difficultyMix}
            onChange={(e) => updateSection(i, { difficultyMix: e.target.value })}>
            {DIFFICULTY_MIXES.map((m) => (
              <option key={m} value={m}>{humanize(m)}</option>
            ))}
          </select>
        </div>
      ))}

      {sections.length < 6 && (
        <p>
          <button type="button" className="secondary small" onClick={() => setSections((prev) => [...prev, emptySection()])}>
            + Add section
          </button>
        </p>
      )}

      <label className="field" htmlFor="bp-time">Total time limit (minutes, 10–180)</label>
      <input id="bp-time" type="number" min={10} max={180} value={timeLimitMin}
        onChange={(e) => { setTimeLimitMin(Number(e.target.value) || 0); setSavedNote(null); }} />
      <p className="hint">
        {totalDraw} question(s) per session · the pool behind it will hold ≥{totalDraw * 6} items
        (6× draw — two candidates never see the same test).
      </p>

      {formError !== null && <p className="form-error">{formError}</p>}
      {savedNote !== null && <p className="form-ok">{savedNote}</p>}
      <p>
        <button type="button" disabled={busy || poolSealed} onClick={() => void save()}>
          {busy ? 'Saving…' : view.blueprint === null ? 'Create blueprint' : 'Update blueprint'}
        </button>
      </p>
    </div>
  );
}

// ─── Step 3: Samples ──────────────────────────────────────────────────────────

function SamplesStep({ jobId }: { jobId: string }): JSX.Element {
  const [samples, setSamples] = useState<SampleItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<SampleItem[]> => {
    const res = await api.get<{ samples: SampleItem[] }>(`/jobs/${jobId}/blueprint/samples`);
    setSamples(res.samples);
    return res.samples;
  }, [jobId]);

  useEffect(() => {
    load().catch((err) => setError(err));
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [load]);

  async function generate(): Promise<void> {
    setBusy(true);
    setFormError(null);
    setSamples(null);
    try {
      await api.post(`/jobs/${jobId}/blueprint/samples`, {});
      // 202 queued — poll until the worker has written sample rows.
      const pollLoad = (): void => {
        void load()
          .then((items) => {
            if (items.length === 0) timerRef.current = setTimeout(pollLoad, POLL_MS);
          })
          .catch((err) => setError(err));
      };
      timerRef.current = setTimeout(pollLoad, POLL_MS);
    } catch (err) {
      setFormError(errMessage(err));
      setSamples([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>3 · Sample questions (preview only)</h2>
      <p className="sub">
        A handful of items in your blueprint&apos;s shape — for a feel of difficulty and tone.
        Samples are never drawn into real sessions.
      </p>

      {samples === null && error === null && <Spinner label="Loading samples…" />}
      {samples !== null && samples.length === 0 && (
        <p className="muted">No samples generated yet.</p>
      )}
      {(samples ?? []).map((sample, i) => (
        <div key={sample.id} className="xray-q">
          <div className="head">
            <span className="badge blue">{humanize(sample.format)}</span>
            <span className="badge outline">{humanize(sample.difficulty)}</span>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              {sample.topics.join(' · ')}
            </span>
            <span className="muted" style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>#{i + 1}</span>
          </div>
          <p style={{ margin: '6px 0' }}>{sample.prompt}</p>
          {sample.options !== undefined && (
            <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
              {sample.options.map((o) => (
                <li key={o.id}>
                  {o.text}
                  {o.truth === true && <span className="badge green" style={{ marginLeft: 8 }}>true</span>}
                  {o.truth === false && <span className="badge outline" style={{ marginLeft: 8 }}>false</span>}
                  {sample.correctOptionId === o.id && <span className="badge green" style={{ marginLeft: 8 }}>correct</span>}
                </li>
              ))}
            </ul>
          )}
          {sample.language !== undefined && (
            <p className="hint">Language: <code>{sample.language}</code></p>
          )}
          {sample.rubric !== undefined && <p className="hint">Rubric: {sample.rubric}</p>}
          {sample.hiddenCases !== undefined && (
            <p className="hint">{sample.hiddenCases.length} hidden test case(s) (graded in sandbox)</p>
          )}
        </div>
      ))}

      {formError !== null && <p className="form-error">{formError}</p>}
      {error !== null && <ErrorBox err={error} note="Could not load samples" />}
      <p>
        <button type="button" className="secondary" disabled={busy} onClick={() => void generate()}>
          {busy ? 'Requesting…' : (samples !== null && samples.length > 0 ? 'Regenerate samples' : 'Generate samples')}
        </button>
      </p>
    </div>
  );
}

// ─── Step 4: Sealed pool ──────────────────────────────────────────────────────

function PoolStep({ jobId }: { jobId: string }): JSX.Element {
  const [pool, setPool] = useState<PoolStatusView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (): Promise<PoolStatusView> => {
    const res = await api.get<PoolStatusView>(`/jobs/${jobId}/pool`);
    setPool(res);
    return res;
  }, [jobId]);

  useEffect(() => {
    load().catch((err) => setError(err));
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [load]);

  async function seal(path: '/pool/seal' | '/pool/reseal'): Promise<void> {
    setBusy(true);
    setFormError(null);
    try {
      await api.post(`/jobs/${jobId}${path}`, {});
      const pollLoad = (): void => {
        void load()
          .then((res) => {
            if (!res.pool.hasActivePool) timerRef.current = setTimeout(pollLoad, POLL_MS);
          })
          .catch((err) => setError(err));
      };
      timerRef.current = setTimeout(pollLoad, POLL_MS);
    } catch (err) {
      setFormError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>4 · Sealed question pool</h2>
      <p className="sub">
        The worker generates ≥6× your draw size, encrypts the pool at rest, and exposes it to
        no one — counts only.
      </p>

      {pool === null && error === null && <Spinner label="Checking pool…" />}
      {pool !== null && pool.pool.hasActivePool && (
        <p className="form-ok" style={{ marginBottom: 0 }}>
          Active pool: {pool.pool.itemCount} items · blueprint v{pool.pool.version} · sealed{' '}
          {fmtDateTime(pool.pool.sealedAt)}
        </p>
      )}
      {pool !== null && !pool.pool.hasActivePool && (
        <p className="muted">No active pool yet — the board shows this role as &ldquo;No test&rdquo; until you seal one.</p>
      )}

      {formError !== null && <p className="form-error">{formError}</p>}
      {error !== null && <ErrorBox err={error} note="Could not load pool status" />}
      <div className="row" style={{ marginTop: 12 }}>
        {pool !== null && !pool.pool.hasActivePool && (
          <button type="button" disabled={busy} onClick={() => void seal('/pool/seal')}>
            {busy ? 'Sealing…' : 'Generate & seal pool'}
          </button>
        )}
        {pool !== null && pool.pool.hasActivePool && (
          <button type="button" className="danger" disabled={busy} onClick={() => void seal('/pool/reseal')}>
            {busy ? 'Re-sealing…' : 'Re-seal (destroy + regenerate)'}
          </button>
        )}
      </div>
      <p className="hint">
        Re-sealing ages out any leaked dump but does not disturb in-flight sessions (they draw
        fail-closed during the swap).
      </p>
    </div>
  );
}

// ─── Step 5: Publish ──────────────────────────────────────────────────────────

function PublishStep({ job, onChanged }: { job: Job; onChanged: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: 'OPEN' | 'PAUSED' | 'CLOSED'): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/jobs/${job.id}/status`, { status });
      onChanged();
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const transitions: Array<'OPEN' | 'PAUSED' | 'CLOSED'> =
    job.status === 'DRAFT' ? ['OPEN'] : job.status === 'OPEN' ? ['PAUSED', 'CLOSED'] : job.status === 'PAUSED' ? ['OPEN', 'CLOSED'] : [];

  return (
    <div className="card">
      <h2>5 · Publish</h2>
      <p className="sub">
        Only OPEN roles appear on the public board. Publishing without a sealed pool is allowed —
        applicants simply get no test link.
      </p>
      <div className="row">
        {transitions.map((t) => (
          <button
            key={t}
            type="button"
            className={t === 'CLOSED' ? 'danger' : undefined}
            disabled={busy}
            onClick={() => void setStatus(t)}
          >
            {t === 'OPEN' ? 'Publish to board' : humanize(t)}
          </button>
        ))}
        {transitions.length === 0 && <span className="muted">This role is closed — no further transitions.</span>}
      </div>
      {error !== null && <p className="form-error">{error}</p>}
      {job.status === 'OPEN' && (
        <p className="hint" style={{ marginTop: 10 }}>
          Live on the board at <Link to={`/jobs/${job.id}`}>/jobs/{job.id}</Link>.
        </p>
      )}
    </div>
  );
}

// DTOs mirroring the actual API contract (apps/api routers are the source of
// truth: modules/public, modules/auth, modules/jobs, modules/applications,
// modules/stats). Dates arrive as ISO strings over JSON.

// ─── Shared vocabulary ────────────────────────────────────────────────────────

/**
 * SUPER_ADMIN is platform-level (PLAN §12 D18): it owns the install —
 * companies, platform settings — and belongs to no company. The other three
 * are company-scoped tenant roles.
 */
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'RECRUITER' | 'INTERVIEWER';
export type JobStatus = 'DRAFT' | 'OPEN' | 'PAUSED' | 'CLOSED';
export type Stage = 'APPLIED' | 'SCREENING' | 'ASSESSMENT' | 'INTERVIEW' | 'OFFER' | 'HIRED';
export type ApplicationStatus = 'ACTIVE' | 'REJECTED' | 'WITHDRAWN' | 'HIRED';
export type RoleFamily = 'ENGINEERING' | 'PRODUCT_MANAGEMENT' | 'DESIGN' | 'DATA' | 'QA' | 'OTHER';
export type WorkMode = 'ONSITE' | 'HYBRID' | 'REMOTE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP';
export type JdStatus = 'JD_DRAFTING' | 'JD_REVIEW' | 'JD_APPROVED';

export type QuestionFormat = 'SWIPE_MCQ' | 'MCQ' | 'WRITTEN' | 'CODE';
export type SignalType = 'TAB_SWITCH' | 'APP_BACKGROUND' | 'BLUR' | 'LARGE_PASTE' | 'COPY' | 'TIMING_ANOMALY';
export type Verdict = 'CORRECT' | 'PARTIAL' | 'INCORRECT';
export type AiLikelihood = 'LOW' | 'MEDIUM' | 'HIGH';
export type SwipeValuation = 'LIKE' | 'DISLIKE';

export const STAGES: readonly Stage[] = [
  'APPLIED',
  'SCREENING',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'HIRED',
];

/** Mirrors apps/api/src/rules/pipeline.ts TRANSITIONS (keep in sync). */
const STAGE_TRANSITIONS: Record<Stage, readonly Stage[]> = {
  APPLIED: ['SCREENING', 'ASSESSMENT', 'INTERVIEW'],
  SCREENING: ['APPLIED', 'ASSESSMENT', 'INTERVIEW'],
  ASSESSMENT: ['SCREENING', 'INTERVIEW'],
  INTERVIEW: ['SCREENING', 'ASSESSMENT', 'OFFER'],
  OFFER: ['INTERVIEW', 'HIRED'],
  HIRED: [],
};
export function stageTransitionsFrom(stage: Stage): readonly Stage[] {
  return STAGE_TRANSITIONS[stage];
}

// ─── Auth (modules/auth) ──────────────────────────────────────────────────────

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
}

// ─── Public board & application (modules/public) ──────────────────────────────

export interface PublicJob {
  id: string;
  title: string;
  department: string;
  roleFamily: RoleFamily;
  location: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string;
  createdAt: string;
  testRequired: boolean;
}

export interface ApplyInput {
  name: string;
  email: string;
  phone?: string;
  resumeUrl?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  coverLetter?: string;
  source?: string;
}

export interface ApplyResponse {
  application: { id: string; jobId: string; createdAt: string };
  testLink: { token: string; expiresAt: string } | null;
  testLinkReason?: 'NO_POOL';
}

/** GET /api/public/test/:token — consent-screen meta, never items. */
export interface TestLinkInfo {
  status: 'ISSUED' | 'STARTED' | 'SUBMITTED' | 'EXPIRED';
  expiresAt: string;
  jobTitle: string;
  timeLimitMin: number | null;
  alreadyUsed: boolean;
}

// ─── Candidate test session (modules/public/session.service) ─────────────────

export interface PresentedOption {
  id: string;
  text: string;
}

/** The candidate-visible surface of a drawn question (lib/session/draw.ts). */
export interface PresentedQuestion {
  prompt: string;
  options?: PresentedOption[];
  language?: string;
  starterCode?: string;
}

/** `presented` travels as Prisma.JsonValue — extract defensively. */
export function asPresented(value: unknown): PresentedQuestion {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const v = value as Partial<PresentedQuestion> & { prompt?: unknown };
    return {
      prompt: typeof v.prompt === 'string' ? v.prompt : '',
      options: Array.isArray(v.options)
        ? v.options
            .filter((o): o is PresentedOption => typeof o === 'object' && o !== null && 'id' in o && 'text' in o)
            .map((o) => ({ id: String(o.id), text: String(o.text) }))
        : undefined,
      language: typeof v.language === 'string' ? v.language : undefined,
      starterCode: typeof v.starterCode === 'string' ? v.starterCode : undefined,
    };
  }
  return { prompt: '' };
}

export interface SessionQuestionView {
  order: number;
  format: string;
  presented: unknown;
}

export type AnswerContent =
  | Record<string, SwipeValuation> // SWIPE_MCQ: optionId → LIKE | DISLIKE
  | { optionId: string } // MCQ
  | { text: string }; // WRITTEN | CODE

/** The session view: questions in order + saved answers + clock meta. */
export interface SessionView {
  questions: SessionQuestionView[];
  answers: Record<string, unknown>;
  meta: {
    deadlineAt: string;
    timeLimitMin: number;
    total: number;
  };
}

// ─── HR jobs & JD (modules/jobs) ──────────────────────────────────────────────

/** Job row as returned by GET /api/jobs (list) — full Prisma shape + counts. */
export interface Job {
  id: string;
  companyId: string;
  title: string;
  department: string;
  roleFamily: RoleFamily;
  location: string;
  workMode: WorkMode;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  description: string;
  status: JobStatus;
  jdStatus: JdStatus | null;
  jdNotes: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { applications: number };
}

export interface IntakeScreenshot {
  name: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  base64: string;
}

export interface IntakeInput {
  notes?: string;
  urls: string[];
  screenshots: IntakeScreenshot[];
}

export interface IntakeResponse {
  job: { id: string; title: string; status: string; jdStatus: string };
  queued: true;
}

/** GET /api/jobs/:jobId/jd (jd.service.getJd). */
export interface JdView {
  jdStatus: JdStatus | null;
  urls: string[];
  screenshotCount: number;
  notes: string | null;
  draft: JdDraft | null;
  error: string | null;
  fetchedExcerpt: string | null;
}

export interface JdDraft {
  title?: string | null;
  department?: string | null;
  roleFamily?: RoleFamily | null;
  location?: string | null;
  workMode?: WorkMode | null;
  employmentType?: EmploymentType | null;
  description?: string | null;
  summary?: string | null;
}

// ─── Blueprint & sealed pool (modules/jobs/blueprint.service) ─────────────────

export interface BlueprintSection {
  title?: string;
  topics: string[];
  formats: Partial<Record<QuestionFormat, number>>;
  difficultyMix?: 'EASY_HEAVY' | 'BALANCED' | 'HARD_HEAVY';
}

export interface BlueprintDto {
  jobId: string;
  sections: BlueprintSection[];
  timeLimitMin: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PutBlueprintInput {
  sections: BlueprintSection[];
  timeLimitMin: number;
}

export interface BlueprintStatusView {
  blueprint: BlueprintDto | null;
  pool: {
    hasActivePool: boolean;
    poolVersion: number | null;
    itemCount: number;
    sealedAt: string | null;
  };
}

export interface PoolStatusView {
  pool: {
    hasActivePool: boolean;
    version: number | null;
    itemCount: number;
    sealedAt: string | null;
  };
}

/** Sample preview items (visible to HR by design; never drawn into sessions). */
export interface SampleItem {
  id: string;
  format: QuestionFormat;
  prompt: string;
  options?: Array<{ id: string; text: string; truth?: boolean }>;
  correctOptionId?: string;
  rubric?: string;
  language?: string;
  starterCode?: string;
  hiddenCases?: Array<{ name: string }>;
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
  topics: string[];
}

// ─── Applications & pipeline (modules/applications) ───────────────────────────

export interface Candidate {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  resumeUrl?: string | null;
  linkedinUrl?: string | null;
  githubUrl?: string | null;
}

export interface InterviewSummary {
  id: string;
  type: string;
  scheduledAt: string;
  status: string;
}

/** Row of GET /api/jobs/:jobId/applications. */
export interface ApplicationListItem {
  id: string;
  jobId: string;
  candidateId: string;
  stage: Stage;
  status: ApplicationStatus;
  source?: string | null;
  coverLetter?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  candidate: Candidate;
  job: { id: string; title: string };
  interviews: InterviewSummary[];
}

export interface StageEventRow {
  id: string;
  applicationId: string;
  fromStage: Stage | null;
  toStage: Stage;
  note?: string | null;
  createdAt: string;
  actor?: { id: string; name: string } | null;
}

export interface ScorecardRow {
  id: string;
  technical: number;
  communication: number;
  problemSolving: number;
  roleFit: number;
  recommendation: string;
  strengths?: string | null;
  concerns?: string | null;
  summary?: string | null;
  author?: { id: string; name: string };
}

export interface InterviewDetail {
  id: string;
  type: string;
  scheduledAt: string;
  durationMinutes: number;
  status: string;
  locationOrLink?: string | null;
  notes?: string | null;
  interviewer?: { id: string; name: string } | null;
  scorecards: ScorecardRow[];
}

/** GET /api/applications/:applicationId — full detail. */
export interface ApplicationDetail extends ApplicationListItem {
  job: Job;
  stageEvents: StageEventRow[];
  interviews: InterviewDetail[];
  scorecards: ScorecardRow[];
}

// ─── HR X-ray (modules/applications/evaluation.service.getXray) ───────────────

export interface XrayEvaluation {
  verdict: Verdict;
  score: number;
  method: string;
  detail?: unknown;
  qualityNotes?: string | null;
  aiLikelihood: AiLikelihood;
  aiReasoning?: string | null;
  voided: boolean;
  createdAt: string;
}

export interface XrayExecution {
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  stdout: string;
  stderr: string;
  caseResults?: Array<{ name?: string; passed?: boolean }> | null;
}

export interface XrayAnswer {
  content: unknown;
  revisions: number;
  firstAnsweredAt: string | null;
  lastAnsweredAt: string | null;
}

export interface XrayQuestion {
  order: number;
  format: string;
  itemId: string;
  presented: unknown;
  answer: XrayAnswer | null;
  evaluation: XrayEvaluation | null;
  executionResult: XrayExecution | null;
}

export interface XrayFlagSummary {
  aiHigh?: number;
  aiMedium?: number;
  signals?: Record<string, number>;
  collusion?: string[];
  unscoredItemIds?: string[];
}

export interface XrayAssessment {
  totalScore: number;
  strengths?: string | null;
  gaps?: string | null;
  recommendation?: string | null;
  flagSummary?: XrayFlagSummary | null;
}

export interface Xray {
  applicationId: string;
  job: { id: string; title: string };
  candidate: { id: string; name: string; email: string };
  stage: Stage;
  status: ApplicationStatus;
  session: {
    id: string;
    status: string;
    startedAt: string | null;
    submittedAt: string | null;
    deadlineAt: string | null;
  } | null;
  available: boolean;
  questions: XrayQuestion[];
  signals: { total: number; byType: Record<string, number> };
  assessment: XrayAssessment | null;
}

// ─── Admin: LLM providers (modules/admin) ─────────────────────────────────────

export type ProviderKind = 'OPENAI_COMPATIBLE' | 'ANTHROPIC' | 'AZURE_OPENAI';

/**
 * Row of GET /api/admin/llm-providers — redacted by contract: no key, no
 * ciphertext, only the last 4 characters (`createdAt` is a Date in the
 * service, ISO over JSON).
 */
export interface RedactedProvider {
  id: string;
  kind: ProviderKind;
  baseUrl: string;
  textModel: string;
  visionModel: string | null;
  isActive: boolean;
  createdAt: string;
  apiKeyLast4: string;
}

/** POST /api/admin/llm-providers body (apiKey min 8 chars — Ollama users: any value). */
export interface CreateProviderInput {
  kind: ProviderKind;
  baseUrl?: string;
  apiKey: string;
  textModel: string;
  visionModel?: string;
  /** Server default is false; activating deactivates every other provider. */
  isActive?: boolean;
}

/** POST /api/admin/llm-providers/:id/test — failures surface as LLM_ERROR (502). */
export interface SmokeTestResult {
  ok: true;
  model: string;
  latencyMs: number;
  reply: string;
}

// ─── Admin: team (modules/users) ──────────────────────────────────────────────

/** Row of GET /api/users — members of the caller's company (joined date included). */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
}

/** POST /api/users body (201 → { user: PublicUser }; 409 EMAIL_TAKEN on duplicates). */
export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

// ─── Auth mode readout (modules/auth GET /api/auth/mode) ──────────────────────

/**
 * Which credential verifier this install runs: `local` = email + password,
 * `oidc` = Keycloak SSO. Since V2-1 (D19) the mode is platform DATA — the
 * super admin switches it via PUT /api/platform/settings; the env setting is
 * the boot-time fallback. Since V2-3 `perCompany` reports whether any company
 * has an ENABLED Keycloak config (tenant SSO in play on top of the mode).
 */
export type AuthMode = 'local' | 'oidc';

/** GET /api/auth/mode response (public, boolean-only). */
export interface AuthModeResponse {
  mode: AuthMode;
  perCompany: boolean;
}

// ─── Admin: company Keycloak/OIDC config (modules/admin, V2-3 D19) ────────────

/** GET/PUT /api/admin/auth-config — the company's own Keycloak verifier. */
export interface CompanyAuthConfig {
  issuerUrl: string;
  audience: string;
  enabled: boolean;
  /** ISO string over JSON. */
  updatedAt: string;
}

/** PUT /api/admin/auth-config body (issuer must be a URL; slashes normalize server-side). */
export interface PutAuthConfigInput {
  issuerUrl: string;
  audience: string;
  enabled: boolean;
}

/** Row of GET /api/platform/auth-configs (SUPER_ADMIN only) — all companies, read-only. */
export interface PlatformAuthConfigRow {
  companyId: string;
  companyName: string;
  authConfig: CompanyAuthConfig | null;
  /** Shape-only hint (http/https URL) — not a live discovery verdict. */
  issuerShapeValid: boolean;
}

// ─── Admin: sandbox image templates (modules/admin, V2-4 D21) ────────────────

/** The languages CODE questions can run (mirrors apps/api CODE_LANGUAGES). */
export type CodeLanguage = 'BASH' | 'NODE' | 'PYTHON';

export const CODE_LANGUAGES: readonly CodeLanguage[] = ['BASH', 'NODE', 'PYTHON'];

/** The company's stored template for one language (null when never saved). */
export interface SandboxTemplateView {
  id: string;
  name: string;
  description: string | null;
  language: CodeLanguage;
  image: string;
  enabled: boolean;
  /** ISO string over JSON. */
  updatedAt: string;
}

/** Row of GET /api/admin/sandbox-templates — one per language, stored or not. */
export interface SandboxTemplateLanguageRow {
  language: CodeLanguage;
  /** The platform default image (what runs without a template). */
  defaultImage: string;
  /** What a CODE answer of this language actually runs today. */
  activeImage: string;
  activeSource: 'COMPANY' | 'PLATFORM';
  template: SandboxTemplateView | null;
}

/** PUT /api/admin/sandbox-templates body (upserts the caller's company row). */
export interface PutSandboxTemplateInput {
  language: CodeLanguage;
  name: string;
  description?: string;
  image: string;
  enabled: boolean;
}

/** Row of GET /api/platform/sandbox-templates (SUPER_ADMIN only) — read-only. */
export interface PlatformSandboxTemplateRow {
  companyId: string;
  companyName: string;
  languages: SandboxTemplateLanguageRow[];
  anyOverride: boolean;
}

// ─── Platform console (modules/platform — SUPER_ADMIN only, D18) ──────────────

/** Row of GET /api/platform/companies — tenants with their user counts. */
export interface PlatformCompany {
  id: string;
  name: string;
  slug: string;
  website: string | null;
  createdAt: string;
  userCount: number;
}

/** Optional first ADMIN created with the company (the "company wizard"). */
export interface FirstAdminInput {
  name: string;
  email: string;
  password: string;
}

/** POST /api/platform/companies body (201 → { company, admin }). */
export interface CreateCompanyInput {
  name: string;
  website?: string;
  firstAdmin?: FirstAdminInput;
}

/** PATCH /api/platform/companies/:id body. */
export interface PatchCompanyInput {
  name?: string;
  website?: string | null;
}

/** GET/PUT /api/platform/settings — the runtime auth-mode switch (D19). */
export interface PlatformSettings {
  authMode: AuthMode;
}

// ─── Two-tier system prompts (founder requirement) ────────────────────────────

/**
 * GET/PUT /api/platform/prompts/main — the platform-wide MAIN prompt tier.
 * Appended ahead of every job's own prompt on every LLM request (JD drafts,
 * question pools, written/code reviews). Readable by every authenticated
 * user; editable only by the super admin.
 */
export interface PlatformMainPrompt {
  mainPrompt: string;
}

/**
 * GET/PUT /api/jobs/:jobId/prompt — the role-specific (job) prompt tier plus
 * the platform main prompt for display convenience. `jobPrompt` is the
 * HR-editable overlay (null = none); `mainPrompt` is read-only here.
 */
export interface JobPromptView {
  jobPrompt: string | null;
  mainPrompt: string;
}

// ─── Dashboard stats (modules/stats) ──────────────────────────────────────────

export interface DashboardStats {
  jobs: { total: number; open: number };
  applications: { total: number; active: number; hired: number; rejected: number };
  byStage: Record<string, number>;
  recentEvents: Array<{
    id: string;
    fromStage: Stage | null;
    toStage: Stage;
    note?: string | null;
    createdAt: string;
    actor?: { name: string } | null;
    application: {
      candidate: { name: string };
      job: { title: string };
    };
  }>;
}

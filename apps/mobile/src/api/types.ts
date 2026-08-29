// Candidate-facing DTOs for the ProvaHR mobile app (D13: same API contract as
// the web portal). Mirrors apps/web/src/api/types.ts — the candidate-relevant
// subset only: this app has no auth, no HR console, no X-ray. The API routers
// (apps/api/src/modules/public) remain the source of truth.

// ─── Shared vocabulary ────────────────────────────────────────────────────────

export type RoleFamily = 'ENGINEERING' | 'PRODUCT_MANAGEMENT' | 'DESIGN' | 'DATA' | 'QA' | 'OTHER';
export type WorkMode = 'ONSITE' | 'HYBRID' | 'REMOTE';
export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'INTERNSHIP';

export type QuestionFormat = 'SWIPE_MCQ' | 'MCQ' | 'WRITTEN' | 'CODE';
export type SignalType = 'TAB_SWITCH' | 'APP_BACKGROUND' | 'BLUR' | 'LARGE_PASTE' | 'COPY' | 'TIMING_ANOMALY';
export type SwipeValuation = 'LIKE' | 'DISLIKE';

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

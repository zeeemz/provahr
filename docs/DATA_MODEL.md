# Data Model

**Last verified: 2026-08-29** — against [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
(waves 0–8) and the first committed migration
[`apps/api/prisma/migrations/0001_init/migration.sql`](../apps/api/prisma/migrations/0001_init/migration.sql).

Conventions: IDs are cuids; all timestamps are UTC; tables are snake_case
(`@@map`), columns keep camelCase names (quoted in SQL). Candidates are **not**
users — they interact only with the public portal. One company per install
(single-tenant MVP; the Company entity survives so multi-tenancy can be added
later without a migration).

## Entity overview

```
Company ─┬─< User                     LlmProvider (admin-configured, ≤1 active)
         └─< Job ─┬─ TestBlueprint ─< SealedQuestionPool   (the sealed pool)
                  ├─< SampleItem                          (preview-only)
                  ├─< TestSession ─┬─< SessionQuestion ─┬─1 Answer
                  │                │                     ├─1? ExecutionResult
Candidate ──< Application ─────────┤                     └─1? Evaluation
                  │                ├─< SessionSignal
                  │                └─1? SessionAssessment
                  ├─< StageEvent
                  ├─< Interview ──< Scorecard (optional link)
                  └─< Scorecard

JobQueue (DB-backed work queue)      VoidedItem (item void ledger, per job)
```

## The ATS spine

### Company (tenant)

| Field | Type | Purpose |
|---|---|---|
| `name` / `slug` | string, slug unique | Display name + URL slug |
| `website`, `logoUrl` | string? | Optional branding |

Singleton invariant: the setup wizard self-locks once a company exists and
`register()` 409s; backed at the DB level by migration-managed
`companies_singleton_idx` (see [Migration-managed indexes](#migration-managed-indexes)).

### User (HR team member)

| Field | Type | Purpose |
|---|---|---|
| `email` | string, unique | Login identifier |
| `passwordHash` | string | bcrypt |
| `role` | `ADMIN` \| `RECRUITER` \| `INTERVIEWER` | RBAC ([docs/RBAC.md](RBAC.md)) |
| `companyId` | FK | Tenant scope — every HR query filters on it |

### Job

| Field | Type | Purpose |
|---|---|---|
| `title`, `department`, `location`, `description` | string | The role |
| `roleFamily` | enum | `ENGINEERING` \| `PRODUCT_MANAGEMENT` \| `DESIGN` \| `DATA` \| `QA` \| `OTHER` — board filter |
| `workMode`, `employmentType` | enums | `ONSITE/HYBRID/REMOTE`; `FULL_TIME/PART_TIME/CONTRACT/INTERNSHIP` |
| `salaryMin`, `salaryMax`, `salaryCurrency` | int?/string? | Band, ISO-4217 |
| `status` | enum | `DRAFT` → `OPEN` → `PAUSED` → `CLOSED`; only `OPEN` shows on the public board |
| `jdStatus` | `JdStatus?` | JD lifecycle: `JD_DRAFTING` → `JD_REVIEW` → `JD_APPROVED` (`JD_FAILED` reserved); **null = never entered the AI intake flow** |
| `jdNotes`, `jdSourceUrls`, `jdScreenshots`, `jdFetchedText` | string/Json? | Role-intake inputs (recruiter brief, reference URLs, screenshots, fetched excerpts) |
| `jdDraft` | Json? | LLM-produced draft object — HR-editable before approval |
| `jdError` | string? | Last generation failure (interim state) |

### Candidate

| Field | Type | Purpose |
|---|---|---|
| `email` | string, unique | Dedupe key — one profile per person |
| `name`, `phone` | string | |
| `resumeUrl`, `linkedinUrl`, `githubUrl` | string? | Links only in MVP |

Data minimization: no addresses, birthdays, photos, or nationality — by design.

### Application

| Field | Type | Purpose |
|---|---|---|
| `jobId` + `candidateId` | unique together | One application per candidate per job |
| `stage` | `Stage` enum | Kanban column (see [Stage rules](#stage-rules)) |
| `status` | enum | Outcome: `ACTIVE` \| `REJECTED` \| `WITHDRAWN` \| `HIRED` — orthogonal to stage |
| `source`, `coverLetter`, `rejectionReason` | string? | `rejectionReason` required when rejecting (fair-hiring audit) |

Stage and status are separate facts; history is preserved in StageEvent.

### StageEvent (append-only audit)

| Field | Type | Purpose |
|---|---|---|
| `applicationId` | FK | |
| `fromStage` / `toStage` | Stage / Stage? | `fromStage` null on creation |
| `actorId` | FK → User? | Null for public/candidate-side submissions |
| `note` | string? | e.g. rejection reason |

Never updated or deleted (fair-hiring requirement, [PLAN.md §8](PLAN.md#8-fair-hiring-privacy--compliance-design-commitments)).

### Interview / Scorecard

Interview: `type` (`PHONE_SCREEN/TECHNICAL/SYSTEM_DESIGN/BEHAVIORAL/PANEL/FINAL`),
`interviewerId?` (FK → User), `scheduledAt` (UTC), `durationMinutes` (default 45),
`status` (`SCHEDULED/COMPLETED/CANCELLED`), `locationOrLink?`, `notes?`.

Scorecard (unique per application+author): `technical/communication/problemSolving/roleFit`
ints 1–5, `strengths/concerns/summary?`,
`recommendation` (`STRONG_HIRE/HIRE/NO_HIRE/STRONG_NO_HIRE`), optional `interviewId?`.

## LLM providers (Phase 1)

### LlmProvider

| Field | Type | Purpose |
|---|---|---|
| `kind` | `OPENAI_COMPATIBLE` \| `ANTHROPIC` \| `AZURE_OPENAI` | Adapter selection |
| `baseUrl` | string | API root (Azure: resource URL; `textModel` is the *deployment* name) |
| `apiKeyEncrypted` | string | AES-256-GCM secret box (`v1.<iv>.<authTag>.<ciphertext>`, base64url) — the raw key is never stored or returned (admin sees last-4 only) |
| `textModel` / `visionModel` | string / string? | Model (or deployment) ids |
| `isActive` | boolean | Exactly one active row: service transaction + partial unique index (migration-managed) |

`apiKeyEncrypted` is decrypted only in the provider loader (`getActiveAdapter`)
and the admin last-4 redactor. See [docs/SELF_HOSTING.md](SELF_HOSTING.md).

## Background job queue (Phase 2)

### JobQueue

| Field | Type | Purpose |
|---|---|---|
| `type` / `payload` | string / Json | `JD_GENERATION`, `SAMPLES_GENERATION`, `POOL_SEAL`, `EVALUATION`, … |
| `status` | `PENDING` \| `RUNNING` \| `DONE` \| `FAILED` | Claimed via conditional `updateMany` — at-most-one worker wins |
| `attempts` / `maxAttempts` / `lastError` | int / string? | Exponential backoff; exhausted rows FAIL on claim |
| `runAt` | DateTime | Backoff/stale-sweep scheduling (idle sweep every 60s) |

Consumed by `src/worker.ts` (`npm run dev:worker`).

## Test blueprint & the sealed pool (Phase 3)

### TestBlueprint (one per job)

| Field | Type | Purpose |
|---|---|---|
| `sections` | Json | `BlueprintSection[]` — topics/format mix/counts/difficulty. **Never a question** |
| `timeLimitMin` | int | Hard session clock |
| `version` | int | Bumped on replace — pools record which version generated them |

### SealedQuestionPool (the "bulletproof" core)

| Field | Type | Purpose |
|---|---|---|
| `jobId`, `blueprintId`, `blueprintVersion` | FKs | Provenance |
| `itemsEncrypted` | string | AES-256-GCM box holding the generated items (≥6× draw size). Exposed by **no** API endpoint to **any** role, admin included |
| `itemCount` | int | |
| `isActive` | boolean | One active pool **per job**; re-seal deactivates the old pool first (fail-closed mid-regeneration) |
| `sealedAt` | DateTime | Newest-first tiebreak for readers |

### SampleItem

Preview-only items shown to HR at blueprint-edit time so they can judge LLM
quality without ever seeing the real pool. By construction excluded from draws
(the draw path reads only `sealed_question_pools.itemsEncrypted`).

**The two pool decrypt sites** (`itemsEncrypted`, and no others):

1. **Session start / draw** — `modules/public/session.service.ts` (API side):
   decrypt once to draw this session's items and variant-realize them.
2. **Evaluation run** — `modules/applications/evaluation.service.ts` (worker
   side, after the session is `SUBMITTED`): decrypt once to recover truth data
   (truth flags, `correctOptionId`, rubrics, hidden cases) for scoring.

Pool-drift policy: if a session's itemIds are no longer in the active pool
(re-sealed after start), those questions are excluded from scoring and noted in
`flagSummary.unscoredItemIds` — a platform-side event never penalizes a candidate.

## One-time test links & the session engine (Phases 4–5)

### TestSession

| Field | Type | Purpose |
|---|---|---|
| `applicationId` | FK, unique | 1:1 with an application |
| `tokenHash` | string, unique | 32 random bytes, URL-safe; stored **only** as sha256 — the plain token leaves the system exactly once (at mint) |
| `issuedAt` / `expiresAt` | DateTime | Link validity |
| `startedAt` / `submittedAt` | DateTime? | Lifecycle: `ISSUED` → `STARTED` → `SUBMITTED` \| `EXPIRED` (`status` string) |
| `deadlineAt` | DateTime? | Set **once** at start — the never-pausing hard clock. Re-entry, revisions and the review pass never move it; 60s submit grace only |

### SessionQuestion (the candidate-visible surface — ends here)

| Field | Type | Purpose |
|---|---|---|
| `sessionId`, `order` | unique together | Linear one-question-at-a-time flow |
| `format` | string | `SWIPE_MCQ` \| `MCQ` \| `WRITTEN` \| `CODE` |
| `itemId` | string | Sealed-pool item id (leak traceability; indexed for void queries) |
| `presented` | Json | Variant-realized view: prompt, options, language, starterCode — **no** truth flags, correctOptionId, rubric or hiddenCases |

Draws are deterministic and seeded (`session.id:pool.id`) — reproducible from
the DB alone. v1 variants reorder options only (data variants are a logged
backlog item).

### Answer (one per session question, upserted as the candidate revises)

| Field | Type | Purpose |
|---|---|---|
| `content` | Json? | SWIPE_MCQ: `{optionId: LIKE\|DISLIKE}`; MCQ: `{optionId}`; WRITTEN/CODE: `{text}` |
| `revisions`, `firstAnsweredAt`, `lastAnsweredAt` | int / DateTime? | Bounded review pass; timing feeds evaluation signals |

### SessionSignal (append-only proctoring evidence)

`type` (`TAB_SWITCH | APP_BACKGROUND | BLUR | LARGE_PASTE | COPY | TIMING_ANOMALY`),
`at`, `detail?` (e.g. `{chars: 1200}`). Signals **flag, never auto-reject** —
they become HR evidence in the assessment rollup, nothing more.

## Sandbox execution & evaluation (Phases 7–8)

### ExecutionResult (one per CODE session question)

`exitCode?`, `durationMs`, `truncated`, `stdout`/`stderr` (capped), `caseResults`
(`CaseOutcome[]` — pass/fail per hidden case with excerpts). Written by the
evaluation worker after running the candidate's code in the hardened
network-off Docker sandbox against the item's hidden cases.

### Evaluation (one per session question — **HR-only, never candidate-reachable**)

| Field | Type | Purpose |
|---|---|---|
| `verdict` | string | `CORRECT` \| `PARTIAL` \| `INCORRECT` |
| `score` | float 0..1 | |
| `method` | string | `DETERMINISTIC` (swipe/mcq) \| `SANDBOX` (code, no LLM) \| `LLM` (written) \| `SANDBOX_LLM` (code + review) |
| `detail` | Json? | Per-option hits / case summary / LLM review text |
| `qualityNotes` | string? | LLM quality review (markdown) |
| `aiLikelihood` | `LOW` \| `MEDIUM` \| `HIGH` | A **flag** for human reviewers — flag, never auto-reject |
| `voided` | boolean | Set when the item is voided; row kept for audit, excluded from the rollup |

Fairness degradation: a WRITTEN answer with no LLM provider scores **nothing**
(no row) rather than an unfair zero — the item is listed in `unscoredItemIds`.
No code path here ever writes Application status.

### SessionAssessment (session rollup — HR-only)

`totalScore` (mean of non-voided evaluation scores), `strengths`/`gaps`
(deterministic topic tallies), `recommendation` (advisory text — humans decide),
`flagSummary` Json: `{aiHigh, aiMedium, signals: {type: n}, collusion: [sessionId…],
unscoredItemIds?}`. Collusion v1 = byte-identical CODE/WRITTEN answers for the
same itemId across submitted sessions of the job — flagged only.

### VoidedItem (the void ledger)

`itemId` (unique), `jobId` (indexed), `reason`, `voidedBy`. Voiding an item
(ADMIN-only, discovered via the X-ray) marks every Evaluation of that item
voided **across all sessions** and re-normalizes each affected
SessionAssessment over the survivors. Voided rows never resurrect on evaluation
re-runs. Fairness: a flawed generated question never silently penalizes candidates.

## Stage rules

Current, enum-backed (Prisma `Stage`; enforced by `src/rules/pipeline.ts`
`TRANSITIONS` + zod in `applications.schema.ts`):

```ts
APPLIED    → SCREENING | ASSESSMENT | INTERVIEW
SCREENING  → APPLIED | ASSESSMENT | INTERVIEW
ASSESSMENT → SCREENING | INTERVIEW
INTERVIEW  → OFFER | SCREENING | ASSESSMENT
OFFER      → HIRED | INTERVIEW
HIRED      → (terminal)
```

Future AI-loop flow (PLAN.md §4 step 7): **Applied → Test → Review → Interview
→ Offer → Hired**. TEST/REVIEW are not enum values yet — enum extension needs
its own migration (the one after 0001_init). Until then the future flow is
exported rules-level as `AI_PIPELINE_STAGES` / `canTransitionAiPipeline` in
`src/rules/pipeline.ts` for display and forward wiring; it supersedes
ASSESSMENT (TEST inherits its edges; REVIEW slots between TEST and INTERVIEW)
and keeps SCREENING as an optional pre-screen. A re-test is a **new** session,
never a backward REVIEW→TEST move.

Rejection/withdrawal is a **status** change available from any stage (except
`HIRED` for rejection), never a stage move; backwards moves are allowed and
always recorded in StageEvent.

## Migration-managed indexes

Three unique indexes are **hand-written in migration `0001_init`** because the
Prisma schema language cannot express them. Drift risk: `prisma db push` and
future `migrate dev` diffs do not know about them — a database created without
running migrations loses them.

| Index | Definition | Closes |
|---|---|---|
| `companies_singleton_idx` | `ON companies ((true))` — at most one company row | QA wave-1 F2 |
| `llm_providers_single_active_idx` | `ON llm_providers ((true)) WHERE "isActive"` — one active provider | QA wave-2 F3 |
| `sealed_pools_single_active_idx` | `ON sealed_question_pools ("jobId") WHERE "isActive"` — one active pool **per job** | QA wave-4 schema note |

Known non-FK: `VoidedItem.jobId` / `.voidedBy` are plain strings (no FK to
jobs/users) — accepted v1; a real FK lands with a future migration if needed.

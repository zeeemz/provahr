# Data Model

**Last verified: 2026-08-31** — against [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
(24 models, waves 0–8 + v2 waves V2-1..V2-4) and the committed migrations
[`0001_init`](../apps/api/prisma/migrations/0001_init/migration.sql) →
[`0005_sandbox_templates`](../apps/api/prisma/migrations/0005_sandbox_templates/migration.sql).

Conventions: IDs are cuids; all timestamps are UTC; tables are snake_case
(`@@map`), columns keep camelCase names (quoted in SQL). Candidates are **not**
users — they interact only with the public portal. Since v2 (D18) an install
is a **multi-tenant platform**: many `Company` rows (created by the super
admin), each owning its users, jobs, providers, Keycloak config and sandbox
templates.

## Entity overview

```
PlatformSettings (singleton: runtime auth mode)          [V2-1]

Company ─┬─< User (SUPER_ADMIN rows live OUTSIDE companies: User.companyId is
         │        nullable since 0002 — the platform owner owns no tenant)
         ├─1? CompanyAuthConfig (the tenant's Keycloak verifier)   [V2-3]
         ├─< SandboxTemplate (per language image override)         [V2-4]
         ├─< LlmProvider (company-scoped; ≤1 active PER COMPANY)   [V2-2]
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
| `name` / `slug` | string, slug unique | Display name + URL slug (slug is stable across renames; collisions get a short random suffix) |
| `website`, `logoUrl` | string? | Optional branding |

Created/renamed/deleted by the **super admin** (`/api/platform/companies`);
deletion cascades the tenant's users, jobs and downstream data. The v1
single-company invariant (`companies_singleton_idx`) was **dropped in
migration 0002** — the install lock is now "a SUPER_ADMIN exists"
(service-level, so more super admins can be added later without a schema
change).

### User (HR team member / platform owner)

| Field | Type | Purpose |
|---|---|---|
| `email` | string, unique | Login identifier |
| `passwordHash` | string | bcrypt |
| `role` | `SUPER_ADMIN` \| `ADMIN` \| `RECRUITER` \| `INTERVIEWER` | RBAC ([docs/RBAC.md](RBAC.md)) |
| `companyId` | FK, **nullable** (0002) | Tenant scope — every HR query filters on it. `null` + `SUPER_ADMIN` = the platform owner; a company-less row of any other role is inert |

`SUPER_ADMIN` was added to the enum in migration 0002 (PostgreSQL 12+ allows
`ADD VALUE` inside the migration transaction).

### PlatformSettings (V2-1, D19)

Singleton row (id `'singleton'`, seeded by migration 0002): `authMode`
(`'local'` | `'oidc'`, default `'local'`) — the runtime sign-in mode the auth
middleware reads per request (10s cache). The env `OIDC_ENABLED` is the
boot-time fallback. Read fails open (login UX must never 500); writes refresh
the cache immediately.

### CompanyAuthConfig (V2-3, D19)

One per company (unique on `companyId`): the tenant's Keycloak/OIDC verifier
as **data**.

| Field | Type | Purpose |
|---|---|---|
| `companyId` | FK, unique | The owning tenant (cascade delete) |
| `issuerUrl` | string | The realm's issuer — the `iss` claim tokens must carry |
| `audience` | string | The Keycloak client id tokens must be for |
| `enabled` | boolean, default **false** | A disabled row authenticates nobody (the middleware filters on it) — drafts are free, disabling is the off-switch |

Constraint: at most one **enabled** row per issuer across all companies
(partial unique index, migration 0004) — `iss` must resolve to exactly one
tenant. No secrets exist in the row.

### SandboxTemplate (V2-4, D21)

Per company per CODE language (unique on `companyId`+`language`): the image
that runs that tenant's code-test answers.

| Field | Type | Purpose |
|---|---|---|
| `companyId` + `language` | FK + string, unique together | `language` ∈ BASH / NODE / PYTHON |
| `name` / `description` | string / string? | Display |
| `image` | string | Lowercase docker reference only (≤100 chars, grammar-enforced at zod, upsert AND build time) |
| `enabled` | boolean, default true | Missing/disabled/unsafe → the platform default image (fail toward the safe image) |
| `createdBy` | FK → User | Audit |

Resolution (`lib/sandbox/templates.ts`): enabled template with a safe image →
the template image; else the platform default (`bash:5.2`, `node:20-alpine`,
`python:3.12-alpine`). The hardened docker argv is byte-identical either way.

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

## LLM providers (Phase 1; company-scoped since V2-2/D20)

### LlmProvider

| Field | Type | Purpose |
|---|---|---|
| `companyId` | FK, nullable | The owning tenant (migration 0003). Pre-V2.2 rows keep NULL — they are inert legacy: every read filters `companyId = <caller's company>`, which NULL never matches |
| `kind` | `OPENAI_COMPATIBLE` \| `ANTHROPIC` \| `AZURE_OPENAI` | Adapter selection |
| `baseUrl` | string | API root (Azure: resource URL; `textModel` is the *deployment* name) |
| `apiKeyEncrypted` | string | AES-256-GCM secret box (`v1.<iv>.<authTag>.<ciphertext>`, base64url) — the raw key is never stored or returned (admin sees last-4 only) |
| `textModel` / `visionModel` | string / string? | Model (or deployment) ids |
| `isActive` | boolean | Exactly one active row **per company**: service transaction + partial unique index (migration-managed, swapped in 0003) |

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

Partial unique indexes are **hand-written in migrations** because the Prisma
schema language cannot express them. Drift risk: `prisma db push` and future
`migrate dev` diffs do not know about them — a database created without
running migrations loses them (the service-level pre-checks remain the
functional guard).

| Index | Definition | Closes | History |
|---|---|---|---|
| `llm_providers_single_active_idx` | `ON llm_providers ("companyId") WHERE "isActive"` — one active provider **per company** | QA wave-2 F3 | 0001 created the global form `((true)) WHERE isActive`; **0003 swapped it to per-company** (without the swap, the second tenant to activate a provider would die on a unique violation; NULL companyIds stay distinct = legacy rows inert) |
| `sealed_pools_single_active_idx` | `ON sealed_question_pools ("jobId") WHERE "isActive"` — one active pool **per job** | QA wave-4 schema note | 0001, unchanged |
| `company_auth_configs_enabled_issuer_key` | `ON company_auth_configs ("issuerUrl") WHERE "enabled"` — one **enabled** config per issuer | V2-3: `iss` must resolve to exactly one tenant (409 `ISSUER_TAKEN` pre-check + this backstop for the race) | 0004 |
| `companies_singleton_idx` | ~~`ON companies ((true))` — at most one company~~ | QA wave-1 F2 | **Dropped in 0002** — companies are tenants now (D18); the install lock is "a SUPER_ADMIN exists", enforced at service level |

Migration chain: `0001_init` (v1 schema + 3 singleton indexes) →
`0002_multitenancy` (SUPER_ADMIN enum value, `User.companyId` nullable,
`platform_settings` + singleton seed, singleton index drop) →
`0003_tenant_llm` (`LlmProvider.companyId` + the index swap) →
`0004_company_auth` (`company_auth_configs` + enabled-issuer index) →
`0005_sandbox_templates` (`sandbox_templates` + plain `@@unique`/`@@index`
constraints — nothing hand-appended).

Known non-FK: `VoidedItem.jobId` / `.voidedBy` are plain strings (no FK to
jobs/users) — accepted v1; a real FK lands with a future migration if needed.

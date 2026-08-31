# The ProvaHR Bible — the map of record

**Last verified: 2026-08-31**

This document is the single entry point to ProvaHR: what the product is, how the
system is actually built, how data flows through the core loop, and where every
kind of truth lives. It is a **map**, not a copy: deeper detail belongs to the
canonical documents it links (the full topic-to-document table is §10). Every
claim here was verified against the code on the date above; file paths are cited
inline so a newcomer can jump straight to the source.

> Reading order for a newcomer: §1 (product) → §2 (architecture) → §4 (the
> loop) → §6 (security model) → §10 (where to go next). §3 and §5 are reference
> material you will return to.

---

## 1. The product in one page

**Thesis.** Hiring is asymmetric today: candidates weaponize AI while HR drowns
in polished, indistinguishable applications. ProvaHR flips the asymmetry —
**AI works for HR** (drafts the JD, generates the test, runs the sandbox,
evaluates the answers), **candidates prove their skill with their own brain**
(a real, role-specific, proctored test on web or phone), and **the evaluation is
asymmetric by design**: the candidate sees `submitted ✓` and nothing else, ever;
HR sees a full X-ray (answers, execution results, verdicts, signals, AI flags)
and then makes every decision themselves. Self-hosted **multi-tenant SaaS
platform** (D18): one install hosts many companies, each with its own LLM keys
(D20), its own Keycloak realm (D19) and its own sandbox images (D21).
One sentence: *AI does the grunt work for HR — and does the candidate's work
for nobody.* ([docs/PLAN.md](PLAN.md) §1)

**The 21 founder-confirmed decisions** (full text: PLAN §12; D1–D17 confirmed
2026-08-28, D18–D21 confirmed 2026-08-29 during the founder's live test):

| # | Decision | One line |
|---|---|---|
| D1 | Product thesis | AI-native hiring: AI for HR, proof-over-polish for candidates, AI-usage detection as the differentiator |
| D2 | AI-cheating policy | Flag for human review — **never auto-reject** |
| D3 | Detection depth v1 | Passive signals + post-hoc LLM analysis; no webcam/screen recording |
| D4 | Test formats | Swipe MCQ (per-option like/dislike) + MCQ + written + code/bash; randomization; bounded review pass |
| D5 | Evaluation visibility | Candidate: submission status only. HR: full X-ray |
| D6 | Tenancy | ~~Single company per install~~ → **superseded in part by D18**: the install is a multi-company platform |
| D7 | Stack | TypeScript end-to-end (Node API + worker, React web, RN mobile) |
| D8 | License | Apache-2.0 |
| D9 | LLM providers | OpenAI-compatible + Anthropic + Azure OpenAI; exactly one active **per company** (D20); admin-configured |
| D10 | Sandbox | Docker per-run, pluggable executor interface; company image templates allowed since D21 |
| D11 | Name | ProvaHR (locked) |
| D12 | Question integrity | "Bulletproof" pool: HR designs only a blueprint; sealed encrypted pool; draw + variants; hidden cases; hard clock; void with renormalization |
| D13 | Mobile | Native candidate app (React Native + Expo); HR console stays responsive web |
| D14 | Swipe MCQ | Cards the candidate likes/dislikes; replay/re-like during review; partial credit per option |
| D15 | Identity | Keycloak OIDC for org users (Azure AD/SAML/LDAP via brokering); local dev JWT retained; candidates never touch Keycloak |
| D16 | Setup | install.sh/cmd + self-locking `/setup` web wizard; compose stack |
| D17 | Process | Parallel agents under disjoint file ownership; serial integration; QA waves audit against the never-regress list |
| D18 | SaaS multi-tenancy | The install is a **platform**: `/setup` creates the SUPER_ADMIN only; companies (tenants) are created from the super-admin console |
| D19 | Runtime auth config | Auth mode + Keycloak settings are **data** (PlatformSettings + CompanyAuthConfig), switchable in the portal — env vars remain boot-time fallbacks |
| D20 | Company-scoped LLM providers | `LlmProvider.companyId`; each tenant brings its own keys; one active per company |
| D21 | Company-scoped sandbox templates | Per-company sandbox image templates per language; builder resolves company template → platform default under identical hardening |

**Roles:** `SUPER_ADMIN` (platform owner: tenants, platform settings — local
sign-in always, no company), then per company `ADMIN` (providers, users,
voids, Keycloak config, sandbox templates, everything company-side),
`RECRUITER` (jobs, JD, blueprints, pipeline), `INTERVIEWER` (read pipeline,
write scorecards); candidate = **no account** (public board + one-time test
link).

---

## 2. Architecture

### 2.1 The system as it actually runs

```
            ┌──────────────────────────────┐        ┌──────────────────────────────┐
            │  apps/web  (React + Vite)    │        │  apps/mobile (React Native  │
            │  · platform console (/app/   │        │  + Expo) — candidate app:   │
            │    platform, SUPER_ADMIN)    │        │  board · apply · consent ·  │
            │  · HR console (/app/*, per   │        │  swipe test (API base is    │
            │    company) + admin settings │        │  absolute, default :4000)   │
            │  · public board + test flow  │        │                              │
            │  · API base = same-origin    │        └──────────────┬───────────────┘
            │    /api (Vite proxy → :4000) │                       │
            └──────────────┬───────────────┘                       │
                           │ REST /api (identical contract, packages/shared vocabulary)
                           ▼
   ┌───────────────────────────────────────────────────────────────────────────┐
   │  apps/api  (Node + TypeScript + Express + Prisma)                         │
   │                                                                           │
   │  entrypoint 1: src/index.ts  → dist/index.js   (HTTP API, port 4000)      │
   │  entrypoint 2: src/worker.ts → dist/worker.js  (background job loop)      │
   │                                                                           │
   │  PLATFORM LAYER (V2-1, super-admin-gated /api/platform):                  │
   │    tenants (Company CRUD + first-ADMIN wizard), PlatformSettings          │
   │    (runtime auth mode), read-only oversight of every tenant's             │
   │    CompanyAuthConfig + SandboxTemplate rows                               │
   │                                                                           │
   │  API side: auth · users · setup wizard (v3: super admin only) ·           │
   │    platform · jobs/JD/blueprint/pool · public board/apply/                │
   │    test-session · applications/X-ray/void · interviews · stats ·          │
   │    admin: llm-providers + auth-config + sandbox-templates                 │
   │    (per company)                                                          │
   │  Worker side (claims rows from job_queue): JD_GENERATION ·                │
   │    SAMPLES_GENERATION · POOL_SEAL · EVALUATION                            │
   └──────┬──────────────────────────────┬───────────────────┬─────────────────┘
          │ Prisma                       │ docker run (CODE  │ HTTPS
          ▼                              │ answers, hardened ▼
   ┌─────────────────┐           │       argv only)  ┌────────────────────────┐
   │  PostgreSQL 16  │           └──────────────────►  LLM provider (exactly │
   │  · 24 models    │                                one active PER COMPANY, │
   │  · job_queue =  │                                BYO key, D20):         │
   │    the DB queue │                                OpenAI-compatible ·    │
   │  · sealed pools │                                Anthropic · Azure      │
   │    (AES-GCM)    │                                OpenAI (also unlocks   │
   │  · platform_    │                                Ollama/vLLM/OpenRouter)│
   │    settings,    │                                └──────────────────────┘
   │    company_auth_│
   │    configs,     │
   │    sandbox_     │
   │    templates    │
   └─────────────────┘
          ▲
   ┌──────┴─────────┐
   │  Keycloak 26   │  (SSO mode, runtime-switchable D19: the platform env
   │  realms, one   │   realm is the fallback; each company may configure
   │  per company   │   ITS OWN realm via CompanyAuthConfig — multi-issuer,
   │  (D19)         │   resolved per token `iss`; orgs federate their own
   └────────────────┘   Azure AD / SAML / LDAP via identity brokering)
```

**Reality notes that older diagrams got wrong:**

- The worker is **not** `apps/worker` — that directory is a placeholder
  (`apps/worker/README.md`). The worker ships as a **second entrypoint inside
  `apps/api`**: `src/worker.ts` → `dist/worker.js`, same codebase and image,
  different CMD (`npm run dev:worker` / `npm run start:worker`,
  `apps/api/package.json`). `apps/worker` remains the promotion target if the
  worker ever outgrows the process (PLAN §7 note).
- One **Postgres** is the source of truth for everything — including the job
  queue (`job_queue` table; no Redis, no broker), the sealed pools, and since
  v2 the platform layer: `platform_settings` (the runtime auth mode),
  `company_auth_configs` (per-tenant Keycloak verifiers) and
  `sandbox_templates` (per-tenant sandbox images).
- The auth mode is **data, not env** (D19): the middleware reads
  `PlatformSettings.authMode` per request (10s cache) and falls back to
  boot-time `OIDC_ENABLED` only when no row exists or the database is
  unreadable. Switching modes in the portal applies on the next request — no
  restart.
- LLM providers are **mock-friendly**: any OpenAI-compatible endpoint works
  (Ollama, vLLM, OpenRouter, LM Studio), which is how the E2E live
  verification ran against a mock provider (`lib/llm/index.ts`,
  `docs/SELF_HOSTING.md`).

### 2.2 Runtime components

| Component | What it is | Where defined |
|---|---|---|
| `api` | Express HTTP server; mounts `/api/*` routers (incl. `/api/platform`, `/api/admin`) + `/setup` wizard + `/health` | `apps/api/src/index.ts`, `src/app.ts` |
| `worker` | Claim/dispatch loop over `job_queue`; graceful SIGINT/SIGTERM shutdown | `apps/api/src/worker.ts` |
| `db` | PostgreSQL 16; Prisma schema (24 models) + committed migrations `0001_init` → `0005_sandbox_templates` (3 hand-written partial unique indexes + the 0003 per-company swap + the 0004 enabled-issuer index) | `apps/api/prisma/schema.prisma`, `docs/DATA_MODEL.md` |
| platform layer | Super-admin console: tenant CRUD, runtime settings, oversight of tenant auth-configs/sandbox-templates | `apps/api/src/modules/platform/`, `apps/web/src/platform/PlatformPage.tsx` |
| `keycloak` | Opt-in OIDC identity provider; the env realm (`provahr`) is the platform fallback, per-company realms are data (D19); brokers Azure AD/SAML/LDAP | `docker-compose.yml`, `deploy/keycloak/`, `docs/RBAC.md` |
| LLM provider | Exactly one active provider **per company** (D20); keys AES-256-GCM-encrypted at rest | `apps/api/src/lib/llm/`, `src/modules/admin/llm-providers.*` |
| web | React + Vite portal: platform console (super admin), HR console, admin settings, public board, candidate test UI | `apps/web/src/` |
| mobile | Expo candidate app (browse, apply, consent, swipe session) | `apps/mobile/src/` |

---

## 3. Module map

### 3.1 `apps/api/src` — one line per directory/file group

| Path | Purpose |
|---|---|
| `index.ts` | HTTP API entrypoint (listen on `PORT`, graceful shutdown) |
| `worker.ts` | Worker entrypoint: claim a due job → dispatch by type → DONE/FAILED → sleep |
| `app.ts` | Express app factory: helmet, CORS, JSON limits (16mb on intake only), morgan with test-token log skip, all router mounts |
| `env.ts` | Zod-validated env; refuses to boot in production on the public dev `SECRETS_KEY` |
| `prisma.ts` / `types.ts` | Prisma singleton; shared `AuthUser` type |
| `middleware/auth.ts` | `requireAuth` (dual-mode, data-driven: local JWT vs Keycloak OIDC with multi-issuer resolution + super-admin carve-out) + `requireRole` |
| `middleware/error.ts` | Uniform error envelope; Zod → 400, body-parser 413 → `REQUEST_TOO_LARGE`, Prisma P2002 → 409 |
| `modules/setup/` | First-run wizard v3 (V2-1): `GET /setup` page (CSP-safe same-origin JS) + status/install API — bootstraps the **super admin only**; self-locking, rate-limited |
| `modules/auth/` | Platform `register` (super admin, 409 once installed), `login` (local mode), `me`, `GET /mode` (runtime mode + perCompany flag) |
| `modules/platform/` | The super-admin console API (V2-1..4, D18/D19): company CRUD + first-ADMIN wizard (`companies.*`), runtime settings (`settings.*`, 10s-cached mode read), `requireSuperAdmin` middleware, read-only oversight of all tenants' auth-configs and sandbox-templates |
| `modules/users/` | Company user list/create (admin) |
| `modules/jobs/` | The jobs spine: CRUD + status + pipeline listing (`jobs.*`), role intake → JD (`jd.*`), blueprint + samples + sealed pool (`blueprint.*`) |
| `modules/public/` | Anonymous surface: board, detail, apply (`public.*`); consent meta + the whole candidate session engine (`session.*`) |
| `modules/applications/` | Application detail/stage/status (`applications.*`), evaluation producer + X-ray + void (`evaluation.*`) |
| `modules/interviews/` | Interview update + scorecard submit |
| `modules/stats/` | Dashboard aggregates for the company |
| `modules/admin/` | Company-scoped admin API: LLM provider CRUD + activate + live smoke test (`llm-providers.*`, V2-2), Keycloak/OIDC config GET/PUT (`auth-config.*`, V2-3), sandbox image templates GET/PUT (`sandbox-templates.*`, V2-4) — keys redacted, everything filtered by `req.user.companyId` |
| `lib/queue.ts` | DB-backed queue primitives: `enqueue`, atomic `claimNext`, `complete`/`fail` with backoff, `requeueStale` |
| `lib/crypto.ts` | AES-256-GCM secret box (`v1.<iv>.<authTag>.<ciphertext>`) for provider keys and pool contents |
| `lib/llm/` | Adapter layer: `types`, `errors` (secret-scrubbing), `http` (timeout/retry), `openai-compatible` / `anthropic` / `azure-openai`, `index` (factory + `getActiveAdapter` seam) |
| `lib/sandbox/` | CODE execution: `templates` (V2-4: platform image allow-list + safe-ref grammar + company-template resolution — pure), `builder` (pure hardened argv + exact-prefix checker, now parameterized by the RESOLVED image), `docker` (spawn-only executor, takes per-run image overrides), `judge` (case comparison), `fake` (tests), `types`, `index` |
| `lib/session/` | `draw` (pure seeded draw + variant realization, compile-time truth-stripping), `clock` (deadline math, 60s submit grace) |
| `lib/assessment/item.ts` | The canonical item vocabulary: 4 formats, zod schemas, blueprint sections, pool math (≥6× draw) |
| `lib/scoring/` | `swipe` (per-option partial credit) and `mcq` (all-or-nothing) — pure |
| `lib/testTokens.ts` | One-time link tokens: mint 43-char URL-safe, sha256-hash storage, shape check |
| `lib/token.ts` | Local-mode HS256 JWT sign/verify |
| `lib/oidc.ts` | OIDC verification: RS256-only, issuer+audience, per-issuer JWKS cache with rotation handling |
| `lib/roles.ts` | Role precedence mapping (ADMIN > RECRUITER > INTERVIEWER) |
| `lib/rateLimit.ts` | Generic fixed-window in-memory per-IP limiter |
| `lib/urlFetch.ts` | SSRF-guarded page fetch + text extraction for role intake |
| `lib/http.ts`, `password.ts`, `slug.ts` | `AppError` + `asyncHandler`; bcrypt; slugify |
| `rules/pipeline.ts` | Stage vocabulary + transition maps — enum-backed spine AND the future AI-loop map (`AI_PIPELINE_*`) |
| `rules/jobStatus.ts` | Job lifecycle DRAFT → OPEN → PAUSED/CLOSED |
| `prompts/` | `jd`, `pool`, `evaluation` — the three LLM prompt families |

### 3.2 `apps/web/src` (React portal; routes in `App.tsx`)

| File | Purpose |
|---|---|
| `api/client.ts`, `api/types.ts` | Typed fetch wrapper; same-origin `/api` base (Vite dev proxy → :4000) |
| `auth/AuthContext.tsx` | Login/session state for the HR console |
| `public/JobBoard.tsx` | Public board (`/`) |
| `public/JobDetail.tsx` | Job detail + apply form; renders the one-time link with copy + unrecoverable warning |
| `public/TestFlow.tsx` | Candidate test flow (`/test/:token`): consent → session (all 4 formats, autosave, review pass, countdown + auto-submit in grace) → `Submitted ✓` |
| `hr/Login.tsx`, `hr/Register.tsx` | Local-mode auth pages (register = platform bootstrap, super admin) |
| `platform/PlatformPage.tsx` | Super-admin console (`/app/platform`): companies table + "New company" wizard modal (tenant + first ADMIN in one POST), auth-mode switch card, all-tenant sandbox-template oversight |
| `admin/ProvidersPage.tsx` | Company LLM providers (V2-2): CRUD, activate, smoke test |
| `admin/TeamPage.tsx` | Company team & RBAC invites |
| `admin/SettingsPage.tsx` | Company settings (V2-3/V2-4): live auth-mode readout, the company's Keycloak config (issuer/audience/enabled), per-language sandbox image templates |
| `hr/Dashboard.tsx` | Company dashboard (`GET /api/stats`) |
| `hr/JobsPage.tsx` | Job list → open console |
| `hr/JobConsole.tsx` | The PLAN §4 loop on one page: JD poll/edit/approve → blueprint → samples → seal → publish |
| `hr/Pipeline.tsx` | Per-job pipeline board (`GET /api/jobs/:id/applications`) |
| `hr/ApplicationDetail.tsx` | Application detail + evaluation X-ray + human stage/status moves + item void |
| `components/ui.tsx`, `styles.css` | Shared UI atoms and styling |

### 3.3 `apps/mobile/src` (Expo candidate app)

| File | Purpose |
|---|---|
| `api/client.ts`, `api/types.ts` | Mobile twin of the web client; absolute API base (`EXPO_PUBLIC_API_URL`, default `http://localhost:4000`) |
| `screens/JobBoardScreen.tsx` | Board with search + pull-to-refresh |
| `screens/JobDetailScreen.tsx` | Detail + apply; one-time token success screen (copy via expo-clipboard, no resend) |
| `screens/TestFlowScreen.tsx` | Consent → session → submitted (platform-honest monitoring disclosure) |
| `screens/TestSessionScreen.tsx` | Session runner: clock, auto-submit in grace, per-format UI |
| `components/SwipeDeck.tsx` | PanResponder swipe deck (LIKE/DISLIKE flings, tap-toggle, replay chips) |
| `hooks/useSignals.ts` | AppState-based signal parity (APP_BACKGROUND ≙ web TAB_SWITCH), flush-on-background |
| `ui.tsx`, `util.ts` | Shared mobile UI + helpers |

Also: `packages/shared` (`src/index.ts`) — the canonical cross-app vocabulary
(stages, formats, signal types, swipe valuations, AI-likelihood, provider
kinds); one source of truth for api/web/mobile contracts.

---

## 4. The core loop as a data flow

**Platform bootstrap (before any of the loop can run, V2-1/D18):**

```
 0. PLATFORM BOOTSTRAP
      fresh install → GET /setup (wizard v3, self-locking)
        POST /api/setup/install {adminName, adminEmail, adminPassword}
          → users (role=SUPER_ADMIN, companyId=null)     [setup.service → register()]
      super admin signs in → POST /api/platform/companies (company wizard)
          → companies + users (first ADMIN)              [one transaction — companies.service.ts]
      the ADMIN signs in and owns the company from the inside:
        LLM keys (V2-2) · Keycloak realm (V2-3) · sandbox images (V2-4) · team
```

The loop below is PLAN §4, annotated with **the tables actually written/read**
at each step (verified in the services cited). Notation: `→` writes,
`·` reads. Every step is scoped to the caller's company (tenant isolation is
the `companyId` filter threaded through every service).

```
 1. INTAKE          HR POST /api/jobs/intake (notes + URLs + screenshots)
        → jobs (placeholder row, jdStatus=JD_DRAFTING, jdNotes/jdSourceUrls/jdScreenshots)
        → job_queue (JD_GENERATION)                     [one transaction — jd.service.ts]
 2. JD GENERATION   worker claims the row; fetches URLs (SSRF-guarded); LLM drafts
        · jobs (jdSourceUrls/jdScreenshots), job_queue (claim)
        → jobs (jdFetchedText, jdDraft, jdStatus=JD_REVIEW | jdError)
        HR GET/PATCH .../jd (edit while in review) → jobs.jdDraft
        HR POST .../jd/approve                          → jobs (fields copied, JD_APPROVED)
 3. BLUEPRINT        HR PUT /api/jobs/:id/blueprint
        → test_blueprints (sections, timeLimitMin, version++)  · jobs (jdStatus gate)
        optional samples: POST .../blueprint/samples → job_queue (SAMPLES_GENERATION)
        → sample_items (preview-only, never drawn)
 4. SEAL             HR POST /api/jobs/:id/pool/seal → job_queue (POOL_SEAL)
        worker generates ≥6× draw per format, validates every item
        → sealed_question_pools (itemsEncrypted AES-256-GCM, itemCount, isActive)
 5. PUBLISH & APPLY  HR POST /api/jobs/:id/status {OPEN} → jobs.status
        candidate POST /api/public/jobs/:id/apply
        → candidates (upsert by email) → applications + stage_events (APPLIED)
        → test_sessions (tokenHash, expiresAt=+14d)  [only if an active pool exists]
 6. TEST SESSION     candidate POST /api/public/test/:token/start
        · test_sessions (hash lookup) · test_blueprints · sealed_question_pools (decrypt #1)
        → session_questions (order, format, itemId, presented) + test_sessions
          (STARTED, startedAt, deadlineAt)              [one transaction]
        answers: POST .../answers → answers (upsert, revisions++)
        signals: POST .../signals → session_signals (append-only, capped at 500)
 7. SUBMIT           candidate POST .../submit
        → test_sessions (SUBMITTED, submittedAt) → job_queue (EVALUATION)
 8. EVALUATION       worker claims EVALUATION; decrypts pool (site #2) for truth data
        SWIPE/MCQ: deterministic (lib/scoring)          → evaluations
        CODE: hardened docker run per hidden case       → execution_results
              + optional LLM review                     → evaluations (SANDBOX_LLM)
        WRITTEN: LLM-graded against rubric              → evaluations (LLM)
        rollup + collusion                             → session_assessments
        HR audit: GET /api/applications/:id/xray        · all of the above (read)
        flawed item: POST /api/applications/admin/items/:itemId/void (ADMIN)
        → voided_items → evaluations.voided=true → session_assessments re-normalized
 9. PIPELINE         humans move the candidate: PATCH .../stage, POST .../status
        → applications (stage/status) + stage_events (append-only audit)
```

**Tables touched per step, in one line each:** intake → `jobs`+`job_queue`;
JD → `jobs.jd*`; blueprint → `test_blueprints` (+`sample_items`); seal →
`sealed_question_pools`; apply → `candidates`+`applications`+`stage_events`+
`test_sessions(tokenHash)`; start → `session_questions(presented)`+
`test_sessions(deadlineAt)`; answers → `answers`; signals → `session_signals`;
submit → `test_sessions`+`job_queue(EVALUATION)`; evaluation → `evaluations`+
`execution_results`+`session_assessments` (+`voided_items` on void).

---

## 5. Sequence diagrams

### 5.1 Platform bootstrap, then HR: companies → intake → JD → approve → blueprint → seal → publish

```
Setup/API         SUPER_ADMIN(web)      API(/api/platform)          DB
  │ POST /setup/install (wizard v3)     │                          │
  ├──────────────►│ (name,email,pw)     │                          │
  │               ├─────────────────────► users(SUPER_ADMIN,       │
  │               │                     │  companyId=null) ──────►│
  │               │◄─ 201 {installed} ────┤ wizard hard-locks        │
  │               │ POST /companies + firstAdmin (one tx)          │
  │               ├────────────────────►│ companies + users(ADMIN)►│
  │               │◄─ 201 {company, admin} — slug auto-freed       │
  │               │ PATCH/DELETE /companies/:id — rename/delete    │
  │               │ PUT /settings {authMode} → runtime switch      │
  │ (the ADMIN signs in at /login and runs the loop below)         │

HR(web)         API(/api/jobs)            job_queue         WORKER            LLM/DB
  │                 │                        │                │                 │
  │ POST /intake    │                        │                │                 │
  ├────────────────►│ create job(JD_DRAFTING)│                │                 │
  │                 │ + enqueue JD_GENERATION (1 tx)          │                 │
  │                 ├───────────────────────►│ PENDING        │                 │
  │◄────────────────┤ 201 {job,queued}       │                │                 │
  │                 │                        │◄───────────────┤ claimNext()     │
  │                 │                        │  RUNNING       │ conditional     │
  │                 │                        │                │ updateMany      │
  │                 │                        │                │ fetch URLs ────►│
  │                 │                        │                │ chat(JD prompt)►│
  │                 │                        │                │ jobs.jdDraft=   │
  │                 │                        │                │  draft,JD_REVIEW│
  │                 │                        │◄───────────────┤ complete → DONE │
  │ GET /:id/jd     │                        │                │                 │
  ├────────────────►│ (poll until JD_REVIEW) │                │                 │
  │ PATCH /:id/jd   │ merge into jdDraft     │                │                 │
  ├────────────────►├──────────────────────────────────────────────────────► jobs
  │ POST /:id/jd/approve → job fields copied, JD_APPROVED    │                 │
  ├────────────────►├──────────────────────────────────────────────────────► jobs
  │ PUT /:id/blueprint (needs JD_APPROVED, no active pool)   │                 │
  ├────────────────►├────────────────────────────────────────────────────► test_blueprints
  │ POST /pool/seal │ enqueue POOL_SEAL      │                │                 │
  ├────────────────►├───────────────────────►│ PENDING        │                 │
  │◄────────────────┤ 202 {queued}           │◄───────────────┤ claim           │
  │                 │                        │                │ batched item    │
  │                 │                        │                │ generation ────►│
  │                 │                        │                │ seal: encrypt ──►
  │                 │                        │                │ sealed_question_
  │                 │                        │◄───────────────┤ pools DONE
  │ GET /:id/pool   │ counts ONLY            │                │                 │
  ├────────────────►│ (hasActivePool, itemCount, sealedAt)    │                 │
  │ POST /:id/status {OPEN} → job OPEN, visible on public board                │
  └─────────────────┴────────────────────────┴────────────────┴─────────────────┘
```

### 5.2 Candidate: apply → token → consent → start → answers/signals → submit

```
Candidate(web/mobile)  API(/api/public)                DB                     job_queue
  │                        │                            │                        │
  │ POST /jobs/:id/apply   │ (20/min/IP limiter)        │                        │
  ├───────────────────────►│ candidate upsert,          │                        │
  │                        │ application create,        │                        │
  │                        │ stage_event(APPLIED) ─────►│                        │
  │                        │ mint token (43 chars)      │                        │
  │                        │ test_session(tokenHash) ──►│ sha256 ONLY            │
  │◄───────────────────────┤ 201 { application, testLink:{token,expiresAt} }    │
  │         ── the plain token leaves the system HERE, exactly once ──          │
  │ GET /test/:token       │ (20/min/IP; uniform 404: bad shape ≡ unknown)      │
  ├───────────────────────►│ hash lookup ──────────────►│ test_sessions          │
  │◄───────────────────────┤ {status, expiresAt, jobTitle, timeLimitMin,        │
  │                        │  alreadyUsed} — NEVER items                        │
  │ POST /test/:token/start│ (60/min session bucket)    │                        │
  ├───────────────────────►│ decrypt pool — SITE #1 ───►│ sealed_question_pools │
  │                        │ draw (seed session:pool)   │                        │
  │                        │ realize variants           │                        │
  │                        │ session_questions ────────►│ + status STARTED,     │
  │                        │                            │  deadlineAt (1 tx)     │
  │◄───────────────────────┤ 201 {questions[presented], answers:{},             │
  │                        │  meta:{deadlineAt,timeLimitMin,total}}             │
  │ POST /answers {order,content} (validated vs format/options)                 │
  ├───────────────────────►│ upsert ───────────────────►│ answers (revisions++) │
  │ POST /signals (batch)  │ append-only, cap 500 ─────►│ session_signals       │
  │                        │ (evidence only — NEVER status)                    │
  │ POST /test/:token/submit (≤60s late = grace)        │                        │
  ├───────────────────────►│ status SUBMITTED ─────────►│ test_sessions         │
  │                        │ enqueue EVALUATION ────────┼───────────────────────►
  │◄───────────────────────┤ { submitted: true }  — nothing else, ever          │
  └────────────────────────┴────────────────────────────┴───────────────────────┘
```

### 5.3 Evaluation worker (post-submit)

```
job_queue      WORKER                    DB                        Docker          LLM
   │              │                       │                           │             │
   │◄─claimNext───┤ EVALUATION(sessionId) │                           │             │
   │  RUNNING     │ session SUBMITTED? ──►│ test_sessions             │             │
   │              │ load + decrypt pool —►│ sealed_question_pools    │             │
   │              │   (SITE #2, truth)    │   + voided_items ledger  │             │
   │              │ for each question:    │                           │             │
   │              │  SWIPE_MCQ ─ scoreSwipe (per-option truth flags)  │             │
   │              │  MCQ ─────── scoreMcq (correctOptionId)           │             │
   │              │   → evaluations (DETERMINISTIC, aiLikelihood LOW) │             │
   │              │  CODE: for each hidden case                       │             │
   │              │   build hardened argv ── docker run ─────────────►│             │
   │              │   (network=none, non-root, RO rootfs,             │             │
   │              │    limits, exact-prefix check pre-spawn)          │             │
   │              │   → execution_results (stdout/exit/caseResults)   │             │
   │              │   + LLM quality review ───────────────────────────────────────►│
   │              │   → evaluations (SANDBOX_LLM, aiLikelihood)       │             │
   │              │  WRITTEN: rubric-graded ──────────────────────────────────────►│
   │              │   → evaluations (LLM)  [no provider ⇒ NO row,    │             │
   │              │    item joins unscoredItemIds — never a zero]    │             │
   │              │ pool drift (item gone) ⇒ skip + flag, not punish │             │
   │              │ rollup: mean of non-voided scores, topic          │             │
   │              │  strengths/gaps, advisory recommendation,         │             │
   │              │  flagSummary {aiHigh, aiMedium, signals,         │             │
   │              │  collusion[], unscoredItemIds?}                  │             │
   │              │ → session_assessments ─►│                         │             │
   │◄─complete────┤ DONE                  │                           │             │
   │  (retry: evaluation rows are idempotent-per-question; voided     │             │
   │   rows never resurrect — re-checked per question)                │             │
   │              │ HR later: X-ray (GET /applications/:id/xray)     │             │
   │              │ ADMIN void → voided_items + evaluations.voided +  │             │
   │              │  re-normalized session_assessments               │             │
   └──────────────┴───────────────────────┴───────────────────────────┴─────────────┘
```

### 5.4 Auth: dual mode, decided by DATA (local JWT vs Keycloak OIDC; D19)

```
Client            API requireAuth                     Postgres/Keycloak
  │  Authorization: Bearer <token>                    │
  ├────────────────►│                                  │
  │                 │ getAuthMode(): PlatformSettings │
  │                 │  .authMode (10s cache; env ────►│ platform_settings
  │                 │  OIDC_ENABLED only as fallback  │ (singleton row)
  │                 │  when no row / db unreadable)   │
  │                 ├─ 'local' ─ local mode ──────────┤
  │                 │  verify HS256 w/ JWT_SECRET     │
  │                 │  load user from Postgres ───────►│ users (by token sub)
  │                 │  (deleted/disabled ⇒ 401 now;   │
  │                 │   SUPER_ADMIN passes w/ null    │
  │                 │   companyId; company-less other │
  │                 │   roles are inert 401s — D18)   │
  │                 ├─ 'oidc' ── SSO mode ────────────┤
  │                 │  local-token carve-outs (D19):  │
  │                 │   verifies locally AND is the   │
  │                 │   SUPER_ADMIN ⇒ PASS (lockout   │
  │                 │   safety — rule 1)               │
  │                 │   is a company user ⇒ 403       │
  │                 │   SSO_MODE_ACTIVE (rule 2)      │
  │                 │  otherwise → multi-issuer path  │
  │                 │   (diagram 5.5)                 │
  │◄────────────────┤ req.user attached; requireRole() gates company routes,
  │                 │ requireSuperAdmin() gates platform routes
  │                 │                                  │
  │ Azure AD users: sign in via the company's Keycloak realm (identity
  │ brokering — the org's own tenant); ProvaHR only ever talks to Keycloak,
  │ so no code changes when brokers change.
  └─────────────────┴──────────────────────────────────┘
```

### 5.5 SSO mode: multi-issuer token resolution (V2-3, D19)

```
Client        requireAuth.ssoAuth          CompanyAuthConfig / env      Keycloak realm
  │ Bearer <RS256 token>                       │                          │
  ├───────────►│ decode `iss` UNVERIFIED ──┐   │                          │
  │            │ (selection input ONLY —   │   │                          │
  │            │  never trusted data; a    │   │                          │
  │            │  forged iss only picks    │   │                          │
  │            │  the verifier that will   │   │                          │
  │            │  reject it)               ▼   │                          │
  │            │ findFirst {issuerUrl: iss, enabled: true}                │
  │            │  ├─ hit  → cfg {issuerUrl, audience, companyId} ─────────│ this company's realm
  │            │  ├─ miss  → iss === env.OIDC_ISSUER_URL ?                │
  │            │  │           {env issuer, env audience, companyId:null}──│ platform-default realm
  │            │  └─ else  → 401 UNAUTHENTICATED (unknown issuer)         │
  │            │ verify RS256 against cfg: issuer (exact string),         │
  │            │  audience, kid→JWKS (per-issuer 10-min cache) ──────────►│ /.well-known/jwks
  │            │ mapRoles: ADMIN>RECRUITER>INTERVIEWER; none ⇒ 403        │
  │            │ provision: user anchored to cfg's company ──► users upsert
  │            │  (env-default path keeps V2-1 first-company join;
  │            │   random unknowable passwordHash — no local login)
  │◄───────────┤ req.user {role, companyId of the matched tenant}
  └────────────┴──────────────────────────────────────────────────────────┘
```

---

## 6. Security model

The invariant list is [docs/TESTING.md](TESTING.md) §6; this is where each one
lives in code.

### 6.1 The two (and only two) pool decrypt sites

| # | Site | When | File |
|---|---|---|---|
| 1 | Session-start draw | fresh start only (re-entry re-reads `session_questions`; the pool is NOT decrypted again) | `apps/api/src/modules/public/session.service.ts` — `parsePoolItems()` called from `startSession()` (~line 261) |
| 2 | Evaluation truth | worker-side, once per EVALUATION run, only after `SUBMITTED` | `apps/api/src/modules/applications/evaluation.service.ts` — `loadActivePoolItems()` (~line 131) |

`decryptSecret` (`lib/crypto.ts`) is imported by exactly four sanctioned files
(crypto, the LLM provider loader, the admin last-4 redactor, and the two sites
above). Everything else must not reach it — this was verified structurally at
the wave-4/6 gates.

### 6.2 Sealed-pool invisibility (structural + tested)

- **Structural**: every pool-facing read selects **scalars only** — `activePoolFor()`
  in `modules/jobs/blueprint.service.ts`, the apply check in
  `modules/public/public.service.ts`, the board's existence probe. The
  `itemsEncrypted` blob never enters the API process outside the two sites
  above (QA wave-4 F4). The only pool DTO any role can see is
  `{hasActivePool, version/poolVersion, itemCount, sealedAt}`.
- **Tested**: the canary-seeded route matrix
  `apps/api/tests/integration/blueprint-pool.test.ts` seeds known plaintext into
  the pool and asserts **no endpoint, for any role (admin included), ever
  returns it**. It runs when `INTEGRATION_DB=1` with a reachable Postgres (the
  tier's first real run was the live V2-1 gate; without the flag the 16 tests
  skip visibly — see §7.4 on CI).
- Sample items are preview-only **by construction** — the draw path reads only
  `sealed_question_pools.itemsEncrypted`, never `sample_items`.

### 6.3 Flag, never auto-reject (the law)

No AI output (verdict, `aiLikelihood`, collusion, signals) can set an
`Application` status — `evaluation.service.ts` writes only evaluation tables;
rejections are human actions requiring a reason (`changeStatus` → `REJECT` needs
`reason`, `applications.service.ts`). Verified by the QA wave-8 **test-spy**:
zero application-status writes from the evaluation path.

### 6.4 One-time test tokens

32 random bytes, base64url without padding = exactly 43 chars from
`[A-Za-z0-9_-]` (`lib/testTokens.ts`). Stored **only** as a sha256 hex hash.
The plain token leaves the system exactly once — in the apply 201 response. A
re-apply 409s **before** any mint (never-regress #3). All `/test/:token`
lookups are hash-only and answer bad shape and unknown token **identically**
(uniform 404 — no validity oracle), and morgan access-logging **skips**
`/api/public/test/*` URLs so the token never lands in logs (`app.ts`, QA wave-5
F1). Links live 14 days (`TEST_LINK_TTL_MS`, `public.service.ts`).

### 6.5 SSRF guard (role-intake URL fetching)

`lib/urlFetch.ts` — `assertPublicHttpUrl` is a pure check of the URL literal:
http(s) only, no embedded credentials, no empty host, rejects
`localhost`/`*.localhost`/`*.local`/`*.internal`, private/reserved IPv4 ranges,
and IPv6 loopback/unspecified (the `[::]` bypass, wave-3 F1)/unique-local/
link-local/multicast/NAT64/6to4/Teredo/embedded-IPv4 forms. The **final
(post-redirect) URL is re-checked** and cannot leak an internal status oracle.
Accepted residual risk (documented in the file): **no DNS resolution** — a
public hostname resolving to a private IP (rebinding) is not stopped in v1.

### 6.6 Sandbox hardening (CODE answers)

`lib/sandbox/builder.ts` builds the whole `docker run` argv as one array (no
shell strings, so no quoting/injection surface). Flags: `--rm`,
`--network none`, `--read-only` rootfs + tmpfs `/tmp:rw,size=16m,exec`,
`--pids-limit 64`, `--memory 256m --memory-swap 256m` (swap off), `--cpus 0.5`,
`--user 65534:65534` (non-root), `--stop-timeout`, `-i` (program travels via
**stdin**, never a host mount). Image resolution (V2-4, D21): platform default
allow-list `bash:5.2`, `node:20-alpine`, `python:3.12-alpine` (the bash tag was
fixed by the live E2E run — see §9), **overridable per company** by an enabled
`SandboxTemplate` row with a grammar-safe reference — see §6.10 for why an
override changes *which* container runs, never *how* it runs. Runtime
backstop: `assertHardenedArgs` enforces **default-deny exact-prefix**
matching — the flag region must *exactly equal* a canonical hardened prefix
for the RESOLVED image (docker's last-occurrence-wins semantics make
"contains the right flags" worthless: `--network none --network host` would
pass). It runs at DockerExecutor construction (boot fail-fast) and before every
spawn. Tokens after the image are the candidate's own program argv — inert
data, never scanned. Output capped at 64 KiB/stream, 10s per case; timeouts
SIGKILL the CLI and rely on dockerd's stop-timeout. v1 limitation: cases drive
programs via **argv only** — a case that also wants stdin is judged
failed-with-note (`SANDBOX_V1_NO_STDIN`).

### 6.7 Rate limits (in-memory, per-process, per-IP)

| Surface | Limit | Where |
|---|---|---|
| `POST /api/setup/install` | 10/hour/IP | `modules/setup/setup.router.ts` |
| `POST /api/public/jobs/:id/apply` | 20/min/IP | `modules/public/public.router.ts` (own bucket) |
| `GET /api/public/test/:token` | 20/min/IP | same (own bucket — probing can't eat apply budget) |
| the 5 session endpoints | 60/min/IP (shared bucket) | same |

Board/detail GETs are unlimited (cheap, no secrets). Limiter state lives in the
process heap — fine for single-process v1; a shared store is a backlog item
(`lib/rateLimit.ts` honestly documents this; proxy guidance in
`docs/SELF_HOSTING.md`).

### 6.8 Secrets handling + the production boot guard

`SECRETS_KEY` (min 16 chars) derives the AES-256-GCM key for provider API keys
**and** pool contents. It is re-derived per call from `process.env` (rotation
without restart). **Production boot guard**: with `NODE_ENV=production` and the
public development default key, `env.ts` refuses to start (`usesUnsafeProductionSecrets`).
Decrypt failures are uniform (`CRYPTO_ERROR`) — never an oracle for why.
`JWT_SECRET` (min 16 chars) signs local-mode HS256 tokens (12h default). Keys
never appear in responses (last-4 only) and are scrubbed from provider error
messages (`lib/llm/errors.ts`).

### 6.9 Multi-issuer OIDC: why the unverified `iss` hop is safe (V2-3, D19)

In SSO mode the middleware decodes the token's `iss` claim **without signature
verification** to select which stored configuration verifies the token
(`resolveOidcConfig` in `middleware/auth.ts`). This is safe because the claim
is used **only to choose key material from trusted storage — never to build a
URL or to trust an identity**: `jwt.verify` then enforces `issuer` (raw-string
comparison against the selected config's `issuerUrl`), `audience`, and the
RS256 signature, so a forged `iss` merely picks the verifier that will reject
the forgery. It is the same trust shape as the pre-existing `kid` header →
JWKS lookup: untrusted input selects, cryptography decides. Backstops: one
**enabled** config per issuer (partial unique index, migration 0004 + a 409
pre-check), a database error degrades to the env-default branch (company
issuers then fail closed), and the two carve-outs of §5.4 guarantee a broken
realm can never lock the platform owner out while company credentials cannot
outlive SSO mode locally (`SSO_MODE_ACTIVE`).

### 6.10 Tenant isolation + template hardening (V2-2/V2-4)

- **Every company-scoped service filters by `req.user.companyId`** — a
  provider/auth-config/template of another tenant is indistinguishable from a
  missing one (same 404, no existence oracle). The company-less `SUPER_ADMIN`
  never passes `requireRole`, so it cannot reach company-scoped services at
  all; conversely `requireSuperAdmin` gates the platform console.
- **Template hardening law (D21, never weaken):** an image override changes
  WHICH container runs, never HOW it runs — the docker flag region
  (`--network none`, `--read-only`, `--user 65534:65534`, …) is byte-identical
  for default and template images, and `assertHardenedArgs` rebuilds its
  canonical prefix from the RESOLVED image. `isSafeImageRef`
  (`lib/sandbox/templates.ts`) accepts only a lowercase docker-ref grammar
  (≤100 chars, no flags/metachars/digests); it is enforced at zod-validate
  time, at upsert time, at build time, and — defense in depth — an unsafe
  stored row silently resolves back to the platform default so evaluation
  never goes down.
- **Docker socket mount (operator-facing):** the worker executes candidate
  code through the HOST's docker daemon (docker-outside-of-docker;
  `docker-compose.yml` mounts `/var/run/docker.sock`). That socket is
  root-equivalent on the host: acceptable for a self-hosted single-operator v1
  (all tenants' code is hardened per §6.6, but they DO share one daemon and
  kernel). Socket-mount isolation per tenant is tracked in the post-v2
  backlog.

---

## 7. Operating it

### 7.1 Install paths

1. **Scripts**: `bash scripts/install.sh [--seed]` (or `scripts/install.cmd` on
   Windows) — checks Node ≥ 20, installs workspaces, creates `apps/api/.env`
   from `.env.example`, generates the Prisma client, applies the migrations
   (`prisma migrate deploy`; 0001–0005), optional demo seed.
2. **Wizard**: first boot on a fresh database → open
   `http://localhost:4000/setup` — the self-locking wizard (v3) creates the
   **platform super admin only** (no company), then hard-locks
   (`GET /api/setup/status` stays, POST 409s). Companies are created next,
   from the super-admin console (`POST /api/platform/companies`, optionally
   with the tenant's first ADMIN in the same request).
3. **Compose**: `docker compose up -d --build` starts `db` (postgres:16) +
   `keycloak` (dev-file H2, realm import from `deploy/keycloak`, port 8081) +
   `api` (built from `apps/api/Dockerfile`; migrate-on-boot;
   `NODE_ENV=production` with its own dev `SECRETS_KEY` so the boot guard
   allows it — **change it**) + `worker` (same image, ALSO migrate-on-boot —
   a fresh volume can never race the API's boot-time migrate; mounts the
   host's `/var/run/docker.sock` for CODE answers, see the security note in
   §6.10).

### 7.2 Running the worker

`npm run dev:worker` (tsx watch) or `npm run start:worker` (`node
dist/worker.js`) from `apps/api`. Same env as the API; `WORKER_POLL_MS`
(default 2000ms) sets the idle sleep. The worker recovers stale `RUNNING` rows
at boot and re-sweeps every 60s while idle; jobs retry with exponential backoff
(5s→cap 5min, `maxAttempts` 3). **Without the worker nothing breaks — enqueued
jobs simply wait** (JD stays `JD_DRAFTING`, pools never seal, evaluations lag).
Single-worker assumption is documented in `lib/queue.ts`.

### 7.3 Environment — the current truth about `.env`

`.env` is **not auto-loaded**: nothing in the API imports dotenv (verified by
grep; found by the 2026-08-29 E2E live run). The scripts and README still
create/copy `.env` as a convenient place to keep values, but the running
process only sees **actual environment variables** — use docker compose
(explicit `environment:`) or inline env (`DATABASE_URL=… JWT_SECRET=… npm run
dev`) or your shell profile. A `--env-file` switch for the dev scripts is a
tracked backlog item. Variables: `DATABASE_URL`, `JWT_SECRET`, `SECRETS_KEY`,
`NODE_ENV`, `PORT` (4000), `JWT_EXPIRES_IN` (12h), `CORS_ORIGIN`, `OIDC_ENABLED`
(false), `OIDC_ISSUER_URL`, `OIDC_AUDIENCE` (provahr-api), `WORKER_POLL_MS` —
full table in [docs/SELF_HOSTING.md](SELF_HOSTING.md). Since V2-3 the three
`OIDC_*` variables are **fallbacks only** (D19): the live auth mode is the
`platform_settings` row, and per-company issuers live in `company_auth_configs`
— both managed from the portal, no restart.

### 7.4 CI tiers

`.github/workflows/ci.yml` — two jobs, no secrets required:
- **api**: checkout → Node 20 → root `npm ci` (workspaces) → `prisma generate`
  → `prisma db push` to a throwaway Postgres **service container** → typecheck
  → `vitest run` with `INTEGRATION_DB=1`, which **unlocks the T2/T3 integration
  tier** (the sealed-pool canary matrix's 16 tests) on every push/PR.
- **shared**: typecheck of `packages/shared`.

Truth-in-advertising: the repo has **no remote**, so CI has **never actually
run** — the workflow is verified by inspection, and the integration tier's
first real execution was the live V2-1 gate run (16/16 on a local Postgres).
First CI run is a tracked post-v2 backlog item.

---

## 8. Testing

Tier table (T1 unit → T8 property-based) and the per-phase contract:
[docs/TESTING.md](TESTING.md). The suite today: **483 passed + 16 skipped
= 499 total** (the 16 = the CI-gated integration tier, which runs for real in
CI). All tests live in `apps/api/tests/*.test.ts` (29 files: queue, urlFetch,
jd/blueprint/session/evaluation routes, crypto, llm adapters, oidc, sandbox
builder + judge + templates, scoring, draw, tokens, setup, admin, platform
routes, auth-multitenant, apply, pipeline, jobStatus, …) plus
`apps/api/tests/integration/blueprint-pool.test.ts`.

**The repeat-run discipline** (process lesson, wave 2): a single green run of a
suite touching randomness proves nothing — gates run the full suite repeatedly
(≥2, up to 5–10× for crypto-adjacent changes). Bug fixes ship with the test
that would have caught them; flaky tests are quarantined within 24h, never left
red or silently deleted.

---

## 9. History & health

### 9.1 The eight QA waves (verdicts and headline findings)

All waves verdict **PASS-WITH-FINDINGS** — clean cores, real findings, all
actionable ones fixed. Detail tables: [PROGRESS.md](../PROGRESS.md).

| Wave | Audited | Headline finding |
|---|---|---|
| 1w.Q | RBAC + setup/deploy | Unauthenticated `POST /api/auth/register` bypassed the wizard's single-company lock (major; fixed — 409 once a company exists) |
| 2.Q | LLM provider subsystem | The "91/91 green" crypto-tamper test was flaky (didn't reproduce) + `SECRETS_KEY` public default accepted in production (both majors; fixed — deterministic tamper + boot guard) |
| 3.Q | Role intake → JD | `http://[::]/` SSRF bypass, live-verified against a dual-stack listener (major; fixed + re-verified) |
| 4.Q | Blueprint + sealed pool | Sealed-pool invisibility was enforced by review only — the leakage matrix had never landed (major; fixed — canary matrix + CI postgres tier) |
| 5.Q | Candidate gateway | morgan logged the plain one-time token's URL, breaking "leaves the system exactly once" at the logging layer (fixed — log skip) |
| 6.Q | Session engine | Honesty: v1 variants reorder options only; PLAN §5.2 mechanism 2's "different concrete tasks" claim was not yet true (fixed in docs; data variants remain backlog) |
| 7.Q | Sandbox executor | The runtime backstop checker missed docker's last-occurrence-wins semantics (`--network none --network host` passed; major; fixed by the exact-prefix redesign) |
| 8.Q | Evaluation + X-ray + void | The evaluation pipeline was dormant — never wired to submit (fixed — submitSession enqueues EVALUATION; per-question void re-check also closed) |

### 9.2 E2E live run (2026-08-29)

Full loop proven live on a real machine: compose Postgres + **first-ever
execution of migration 0001** (all three singleton indexes verified) + a mock
OpenAI-compatible provider through the real admin surface. Wizard → login →
provider → intake → JD approve → blueprint → pool sealed (14 items, ×6 math
exact) → publish → apply → one-time token → consent → start (MCQ + CODE/BASH)
→ answers → signals → submit → worker evaluation DONE → X-ray (MCQ
DETERMINISTIC 1.0; CODE SANDBOX_LLM 1.0 in a real container, both hidden cases
passed; TAB_SWITCH flagged; advisory-only recommendation). **Two real findings,
both actioned:** (1) `bash:5.2-alpine` does not exist on Docker Hub — every
BASH sandbox run would have failed in production; fixed to `bash:5.2`,
verified by live pull. (2) The documented `.env` flow is broken — nothing
loads `.env` (see §7.3). Fail-closed pool sealing also behaved as designed
against a misbehaving mock provider (bounded retries, clean FAILED rows).

### 9.3 The v2 SaaS waves (2026-08-29 → 2026-08-31, V2-1..V2-5)

Founder pivot after the v1 E2E live run: the install becomes a multi-tenant
platform (D18–D21, PLAN §12). Each wave shipped with tests, a live E2E
regression pass, and a git checkpoint; details in [PROGRESS.md](../PROGRESS.md).

| Wave | Shipped | E2E / integration catches |
|---|---|---|
| V2-1 | Multi-tenant core: `SUPER_ADMIN` role, nullable `User.companyId`, `PlatformSettings` + migration 0002, platform router (company CRUD + settings), wizard v3 (super admin only) | The CI-gated integration tier ran **live for the first time** (16/16 on a real Postgres) and exposed 2 latent test bugs (fixed); the 0002 drop of 0001's single-company index is what made tenants legal |
| V2-2 | Company-scoped LLM providers: `LlmProvider.companyId` (migration 0003), tenancy-threaded services + admin UI | **Worker/migrate race**: on a fresh volume the worker crashed P2021 on `job_queue` because the API's boot-time migrate had not finished — the worker now migrates on boot too; **worker docker ENOENT**: sandbox spawn needed the host socket + CLI inside the image (compose mount); **index swap**: 0001's global single-active became per-company (`(companyId) WHERE isActive`) or the second tenant's activation would die |
| V2-3 | Runtime per-company Keycloak: `CompanyAuthConfig` (migration 0004, enabled-issuer partial unique), multi-issuer middleware, portal switch + company config UI, super-admin carve-outs | Lockout carve-out **live-proven**: with SSO on, the super admin still signs in locally while company locals get `SSO_MODE_ACTIVE`; the mode switch verified effective on the very next request (no restart) |
| V2-4 | Company sandbox templates: `SandboxTemplate` (migration 0005), `lib/sandbox/templates.ts` resolution + safe-ref grammar, parameterized exact-prefix hardening, company + platform UIs | Template save + unsafe-image reject verified live; the hardened argv is byte-identical under an override (parameterized exact-prefix — the default argv is itself rejected in override mode, so a stale prefix can never pass) |
| V2-5 | Docs reconciliation (this sweep): every doc tells the platform story | — |

### 9.4 Post-MVP / post-v2 backlog (from PROGRESS.md)

Stage-enum migration (TEST/REVIEW as real enum values; the AI-loop board is
rules-level today) · `VoidedItem` FK to jobs/users (plain strings now) ·
live-docker sandbox verification of containment (network-kill/uid/runaway-kill)
· shared rate-limiter store across API processes · per-session **data variants**
(completing PLAN §5.2 mechanism 2) · error-log redaction · manual
redirect-loop handling in `urlFetch` · screenshot retention window + erasure
endpoint (PLAN §10) · CI first-run observation of the integration tier ·
`--env-file` for dev scripts · **CI has never run (no remote)** · automated
E2E tier (T7) · docker socket-mount isolation per tenant. (The owed CODE-format
evaluation test landed with wave 10.)

---

## 10. Where truth lives

| Topic | Canonical document |
|---|---|
| Product, scope, decisions D1–D21, roadmap | [docs/PLAN.md](PLAN.md) |
| Schema, 24 models, field-level docs, migration-managed indexes | [docs/DATA_MODEL.md](DATA_MODEL.md) |
| Every route: method, path, role, shapes, error codes | [docs/API.md](API.md) |
| Test tiers, per-phase contract, never-regress list | [docs/TESTING.md](TESTING.md) |
| Install, env vars, LLM providers, upgrades, proxy notes | [docs/SELF_HOSTING.md](SELF_HOSTING.md) |
| Identity: local vs Keycloak, role mapping, Azure AD brokering | [docs/RBAC.md](RBAC.md) |
| History: waves, changelog, risks, QA finding tables | [PROGRESS.md](../PROGRESS.md) |
| The docs system itself (inventory + rules) | [docs/DOCUMENTATION.md](DOCUMENTATION.md) |

When this document and a canonical doc disagree, the canonical doc wins (and
this file has a bug — fix it). When a canonical doc and the code disagree, the
code wins (and the doc has a bug — fix that too).

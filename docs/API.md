# ProvaHR API Reference

**Last verified: 2026-08-31** — transcribed from the routers in
`apps/api/src/modules/**` (mounted in `apps/api/src/app.ts`). Roles:
"auth" = any authenticated user; `SUPER_ADMIN` = the platform owner
(company-less); roles in parentheses = the `requireRole` /
`requireSuperAdmin` gate. The documented web client uses a same-origin base
(`/api`, Vite dev proxy → `http://localhost:4000`); the mobile client uses
`<API_URL>/api` (default `http://localhost:4000/api`).

Conventions that apply everywhere:

- Auth is `Authorization: Bearer <token>` (local-mode JWT or Keycloak OIDC
  access token — see [RBAC.md](RBAC.md)). Missing/bad token → **401
  `UNAUTHENTICATED`**; wrong role → **403 `FORBIDDEN`**; a company user's
  local token under SSO mode → **403 `SSO_MODE_ACTIVE`**.
- Errors are always `{ "error": { "code", "message", "details"? } }`.
  Zod failures → **400 `VALIDATION_ERROR`** with per-field `details`; oversized
  bodies → **413 `REQUEST_TOO_LARGE`**; Prisma unique races → **409
  `CONFLICT`**; unknown routes → **404 `NOT_FOUND`** (`middleware/error.ts`).
- All company data is scoped to the caller's company; another company's (or
  nonexistent) resource answers the same **404**. `SUPER_ADMIN` reaches only
  the platform routes below — company-scoped routes never admit it.

---

## Setup (first-run) — mounted at `/api/setup` (+ the page at `/setup`)

Wizard v3 (V2-1/D18): bootstraps the **platform super admin only** — no
company here; tenants come next from the platform console.

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/setup/status` | public | → `{ installed: boolean }` — true once a SUPER_ADMIN exists |
| GET | `/api/setup` (also `/setup`) | public | → the wizard HTML page (2 steps: install, auth-mode readout + finish) |
| GET | `/api/setup/wizard.js` | public | → the wizard's same-origin JS (helmet CSP blocks inline) |
| POST | `/api/setup/install` | public, **10/hour/IP** | `{ adminName, adminEmail, adminPassword (min 8) }` → **201** `{ installed: true, adminEmail }` — creates the SUPER_ADMIN (no `companyName`). Errors: **409 `ALREADY_INSTALLED`** (hard-locks after first success), **400**, **429 `RATE_LIMITED`** |

Health: `GET /health` (public) → `{ status: "ok" }`.

## Auth — `/api/auth`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/mode` | public | → `{ mode: "local" \| "oidc", perCompany: boolean }` — the runtime mode from `PlatformSettings.authMode` (env `OIDC_ENABLED` as fallback; never 500s) and whether any company has an **enabled** Keycloak config. Clients pick login UX from this |
| POST | `/register` | public | `{ name, email, password (min 8) }` → **201** `{ token, user }` — creates the install's SUPER_ADMIN (no company; same service the wizard uses). Errors: **409 `ALREADY_INSTALLED`** (a super admin exists — the wizard is the bootstrap), **409 `EMAIL_TAKEN`** |
| POST | `/login` | public | `{ email, password }` → `{ token, user }`. Errors: **401 `INVALID_CREDENTIALS`** (constant-time vs a dummy hash) |
| GET | `/me` | auth | → `{ user }` (SUPER_ADMIN carries `companyId: null`) |

## Platform console — `/api/platform` (all SUPER_ADMIN; V2-1..4)

Every route is `requireAuth` + `requireSuperAdmin`. This is the tenant and
platform-settings surface; read-only oversight lists include every company.

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/platform/companies` | → `{ companies: [{ id, name, slug, website, createdAt, userCount }] }` (newest first) |
| POST | `/api/platform/companies` | `{ name (2-120), website?, firstAdmin?: { name, email, password (min 8) } }` → **201** `{ company, admin \| null }` — creates a tenant and, optionally, its first ADMIN in one transaction (slug auto-freed on collision). Errors: **409 `EMAIL_TAKEN`** (firstAdmin's email), **400** |
| PATCH | `/api/platform/companies/:id` | `{ name?, website? }` → `{ company }` (slug is stable across renames). Errors: **404 `NOT_FOUND`** |
| DELETE | `/api/platform/companies/:id` | → **204** — cascades the tenant's users, jobs and downstream data. Errors: **404** |
| GET | `/api/platform/settings` | → `{ authMode: "local" \| "oidc" }` — the runtime mode readout |
| PUT | `/api/platform/settings` | `{ authMode: "local" \| "oidc" }` → `{ authMode }` — the live switch: takes effect on the next request (the auth middleware reads the row per request behind a 10s cache, which this write refreshes immediately) |
| GET | `/api/platform/auth-configs` | → `{ configs: [{ companyId, companyName, authConfig: { issuerUrl, audience, enabled, updatedAt } \| null, issuerShapeValid }] }` — every tenant's Keycloak config with a URL-shape hint (no live round-trip) |
| GET | `/api/platform/sandbox-templates` | → `{ companies: [{ companyId, companyName, languages: [{ language, defaultImage, activeImage, activeSource: "COMPANY" \| "PLATFORM", template? }], anyOverride }] }` — read-only oversight of which images run per tenant |

## Users — `/api/users`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/users` | auth | → `{ users }` (the caller's company) |
| POST | `/api/users` | **ADMIN** | `{ email, name, password, role: ADMIN\|RECRUITER\|INTERVIEWER }` → **201** `{ user }`. Errors: **409 `EMAIL_TAKEN`** |

## Jobs — `/api/jobs` (the spine: CRUD, JD, blueprint, pool)

Company-scoped throughout. Job body fields (`title`, `department`,
`roleFamily`, `location`, `workMode`, `employmentType`, `salaryMin/Max`,
`salaryCurrency`, `description`) are validated by `jobs.schema.ts`.

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/jobs` | auth | query `status?, roleFamily?, q?` → `{ jobs }` |
| POST | `/api/jobs` | ADMIN, RECRUITER | job body → **201** `{ job }` |
| POST | `/api/jobs/intake` | ADMIN, RECRUITER | `{ notes?, urls?: string[], screenshots?: [{name, mediaType, base64}] }` — **16mb body limit** (route-scoped; everything else is 1mb) → **201** `{ job: {id, title, status, jdStatus}, queued: true }`. Errors: **503 `NO_PROVIDER`** (checked before anything is created), **400 `INVALID_URL`** (SSRF guard) |
| GET | `/api/jobs/:jobId/jd` | ADMIN, RECRUITER | → `{ jd: { jdStatus, urls, screenshotCount, notes, draft, error, fetchedExcerpt } }` |
| PATCH | `/api/jobs/:jobId/jd` | ADMIN, RECRUITER | draft patch (deep-merged) → `{ draft }`. Errors: **409 `JD_NOT_EDITABLE`** (only editable while `JD_REVIEW`) |
| POST | `/api/jobs/:jobId/jd/approve` | ADMIN, RECRUITER | `{}` → `{ job }` (present draft fields copied onto the job; `JD_APPROVED`) |
| PUT | `/api/jobs/:jobId/blueprint` | ADMIN, RECRUITER | `{ sections: [{ title?, topics[1-5], formats{SWIPE_MCQ\|MCQ\|WRITTEN\|CODE: 1-10}, difficultyMix? }], timeLimitMin }` → `{ blueprint }` (version bumps). Errors: **409 `JD_NOT_APPROVED`**, **409 `POOL_SEALED`** (blueprint frozen once a pool exists — re-seal to edit) |
| GET | `/api/jobs/:jobId/blueprint` | ADMIN, RECRUITER | → `{ blueprint, pool: {hasActivePool, poolVersion, itemCount, sealedAt} }` |
| POST | `/api/jobs/:jobId/blueprint/samples` | ADMIN, RECRUITER | `{}` → **202** `{ queued: true }` (preview items). Errors: **404 `BLUEPRINT_NOT_FOUND`**, **503 `NO_PROVIDER`** |
| GET | `/api/jobs/:jobId/blueprint/samples` | ADMIN, RECRUITER | → `{ samples }` — preview-only items, visible **by design**, never drawn into sessions |
| POST | `/api/jobs/:jobId/pool/seal` | ADMIN, RECRUITER | `{}` → **202** `{ queued: true }` (worker generates ≥6× draw and seals). Errors: **404 `BLUEPRINT_NOT_FOUND`**, **409 `POOL_SEALED`**, **503 `NO_PROVIDER`** |
| POST | `/api/jobs/:jobId/pool/reseal` | ADMIN, RECRUITER | `{}` → **202** `{ queued: true }` — deactivates the old pool **immediately** (transactional with the enqueue), then regenerates |
| GET | `/api/jobs/:jobId/pool` | ADMIN, RECRUITER | → `{ pool: { hasActivePool, version, itemCount, sealedAt } }` — **counts only; no endpoint anywhere returns pool items to any role** |
| GET | `/api/jobs/:jobId` | auth | → `{ job }` |
| PATCH | `/api/jobs/:jobId` | ADMIN, RECRUITER | partial job body → `{ job }` |
| DELETE | `/api/jobs/:jobId` | ADMIN, RECRUITER | → **204** (cascades applications) |
| POST | `/api/jobs/:jobId/status` | ADMIN, RECRUITER | `{ status: DRAFT\|OPEN\|PAUSED\|CLOSED }` → `{ job }` (validated lifecycle transitions, `rules/jobStatus.ts`; only `OPEN` shows on the public board) |
| GET | `/api/jobs/:jobId/applications` | auth | query `stage?, status?` → `{ applications }` (pipeline board) |

## Public board & apply — `/api/public`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/public/jobs` | public | query `q?, roleFamily?, workMode?` → `{ jobs }` (OPEN only; each carries `testRequired` = an active pool exists — an existence probe, never pool data) |
| GET | `/api/public/jobs/:jobId` | public | → `{ job }` (same shape; **404** for non-OPEN/unknown) |
| POST | `/api/public/jobs/:jobId/apply` | public, **20/min/IP** | `{ name, email, phone?, resumeUrl?, linkedinUrl?, githubUrl?, coverLetter?, source? }` → **201** `{ application: {id, jobId, createdAt}, testLink: {token, expiresAt} \| null, testLinkReason?: "NO_POOL" }`. **The plain one-time token appears in this response and nowhere else, ever.** Errors: **404** (not OPEN), **409 `ALREADY_APPLIED`** (fires before any token is minted), **429 `RATE_LIMITED`** |

## One-time test link & candidate session — `/api/public/test/:token`

All five share one **60/min/IP** bucket. Every lookup goes through the token
**hash**; bad shape and unknown token answer the **same 404** (no validity
oracle), and these URLs are skipped by access logging. The candidate-visible
surface never carries scores, verdicts, or feedback (asymmetry).

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/public/test/:token` (**20/min/IP**, own bucket) | → `{ status, expiresAt, jobTitle, timeLimitMin, alreadyUsed }` (consent screen; NEVER items). Errors: **404** (uniform) |
| POST | `/api/public/test/:token/start` | body `{}` → **201** fresh start / **200** idempotent re-entry: `{ questions: [{order, format, presented}], answers: {order→content}, meta: {deadlineAt, timeLimitMin, total} }`. Errors: **409 `SESSION_SUBMITTED`**, **410 `TEST_LINK_EXPIRED`** (lazy ISSUED→EXPIRED flip), **409 `SESSION_EXPIRED`** (re-entry past deadline), **409 `BLUEPRINT_NOT_FOUND` / `POOL_INACTIVE`** (fail-closed mid-reseal), **500 `POOL_CORRUPT`** |
| GET | `/api/public/test/:token/session` | → the same view shape (refresh-safe; re-reads persisted questions — no second decrypt). Errors: as above |
| POST | `/api/public/test/:token/answers` | `{ order, content }` where content is `{optionId: LIKE\|DISLIKE}` (SWIPE_MCQ), `{optionId}` (MCQ) or `{text ≤10k chars}` (WRITTEN/CODE) → `{ saved: true }`. Errors: **400 `INVALID_ANSWER`**, **404** (unknown order), **409 `SESSION_EXPIRED`** (no grace on answers) |
| POST | `/api/public/test/:token/signals` | `{ signals: [{type, at, detail?}] }` (types: `TAB_SWITCH \| APP_BACKGROUND \| BLUR \| LARGE_PASTE \| COPY \| TIMING_ANOMALY`) → `{ recorded: n }` — append-only evidence, capped at 500/session, **never** changes status |
| POST | `/api/public/test/:token/submit` | body `{}` → `{ submitted: true }` — and nothing else, ever. A submit ≤60s past the deadline is accepted (grace); later → **409 `SESSION_EXPIRED`** |

## Applications pipeline + X-ray + void — `/api/applications`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/applications/:applicationId` | auth | → `{ application }` (candidate, history, interviews, scorecards) |
| PATCH | `/api/applications/:applicationId/stage` | ADMIN, RECRUITER | `{ stage: APPLIED\|SCREENING\|ASSESSMENT\|INTERVIEW\|OFFER\|HIRED }` → `{ application }` (validated transitions, `rules/pipeline.ts`; audit `StageEvent` appended) |
| POST | `/api/applications/:applicationId/status` | ADMIN, RECRUITER | `{ action: REJECT\|WITHDRAW\|REOPEN, reason? }` → `{ application }` — REJECT requires a reason and a human (flag, never auto-reject) |
| GET | `/api/applications/:applicationId/interviews` | auth | → `{ interviews }` |
| POST | `/api/applications/:applicationId/interviews` | ADMIN, RECRUITER | `{ type, scheduledAt, durationMinutes?, interviewerId?, locationOrLink?, notes? }` → **201** `{ interview }` |
| GET | `/api/applications/:applicationId/xray` | auth (any company role) | → `{ xray }` — the asymmetric outcome, HR side: session meta, every question + answer, per-question evaluation (verdict/score/method/aiLikelihood/voided), execution results, signal rollup, assessment. `available: false` with empty arrays until the session is `SUBMITTED`. Errors: **404** |
| POST | `/api/applications/admin/items/:itemId/void` | **ADMIN** | `{ reason }` → `{ void: { itemId, jobId, evaluationsVoided, sessionsRenormalized } }` — voids the item **across all sessions** and re-normalizes every affected assessment. Errors: **404** (unknown or other company) |

## Interviews & scorecards — `/api/interviews`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| PATCH | `/api/interviews/:interviewId` | ADMIN, RECRUITER | partial `{ scheduledAt?, durationMinutes?, interviewerId?, locationOrLink?, notes?, status? }` → `{ interview }` |
| POST | `/api/interviews/:interviewId/scorecard` | auth (any company member authors) | `{ technical, communication, problemSolving, roleFit (1–5), recommendation: STRONG_HIRE\|HIRE\|NO_HIRE\|STRONG_NO_HIRE, strengths?, concerns?, summary? }` → **201** `{ scorecard }` (unique per application+author) |

## Stats — `/api/stats`

| Method | Path | Auth | Request → Response |
|---|---|---|---|
| GET | `/api/stats` | auth | → `{ jobs: {total, open}, applications: {total, active, hired, rejected}, byStage: {…}, recentEvents: [...] }` (company dashboard; the endpoint is `/api/stats`, not `/api/stats/dashboard`) |

## Admin (company-scoped) — `/api/admin/*` (all ADMIN)

All three groups scope by the caller's `companyId` (`requireRole('ADMIN')`
never admits the company-less SUPER_ADMIN): another company's resource answers
the same **404**. Provider config examples with curl walkthroughs live in
[SELF_HOSTING.md](SELF_HOSTING.md).

### LLM providers — `/api/admin/llm-providers`

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/admin/llm-providers` | → `{ providers }` — **redacted**: no keys, no ciphertext, `apiKeyLast4` only |
| POST | `/api/admin/llm-providers` | `{ kind: OPENAI_COMPATIBLE\|ANTHROPIC\|AZURE_OPENAI, baseUrl, apiKey, textModel, visionModel?, isActive? }` → **201** `{ provider }` |
| PATCH | `/api/admin/llm-providers/:id` | partial of the above — omit `apiKey` to keep the stored one → `{ provider }` |
| POST | `/api/admin/llm-providers/:id/activate` | → `{ provider }` — atomically deactivates the **company's** others (per-company single-active, migration 0003); there is deliberately no deactivate endpoint |
| POST | `/api/admin/llm-providers/:id/test` | → `{ ok: true, model, latencyMs, reply }` (live round-trip) or **502 `LLM_ERROR`** (provider status in the message, key never included) |
| DELETE | `/api/admin/llm-providers/:id` | → **204** (deleting the active row leaves the company with zero active — AI features then fail with **503 `NO_PROVIDER`** until another is activated) |

### Keycloak / OIDC config — `/api/admin/auth-config` (V2-3)

Exactly one config per company: GET/PUT on the collection, no `:id` routes and
no DELETE — `enabled: false` is the off-switch (a disabled row authenticates
nobody), which keeps a re-enable one PUT away.

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/admin/auth-config` | → `{ authConfig: { issuerUrl, audience, enabled, updatedAt } \| null }` (null = never saved) |
| PUT | `/api/admin/auth-config` | `{ issuerUrl (http(s) URL), audience, enabled }` → `{ authConfig }` — upserts the company's verifier; in SSO mode tokens whose `iss` matches `issuerUrl` verify against this config and join **this** company. Errors: **409 `ISSUER_TAKEN`** (another company already has this issuer **enabled**; disabled drafts never clash — the migration 0004 partial unique index backstops the race as Prisma P2002 → 409) |

### Sandbox image templates — `/api/admin/sandbox-templates` (V2-4)

One template per language per company (`@@unique([companyId, language])`):
PUT carries the language in the body, no DELETE — `enabled: false` keeps the
platform default.

| Method | Path | Request → Response |
|---|---|---|
| GET | `/api/admin/sandbox-templates` | → `{ templates: [{ language, defaultImage, activeImage, activeSource: "COMPANY"\|"PLATFORM", template: { id, name, description, language, image, enabled, updatedAt } \| null }] }` — always one row per CODE language (BASH/NODE/PYTHON), stored or not |
| PUT | `/api/admin/sandbox-templates` | `{ language: BASH\|NODE\|PYTHON, name (1-120), image, enabled, description? }` → `{ template }` (the same row shape as above). `image` must be a lowercase docker reference (registry, optional `:port`, path, optional `:tag`; ≤100 chars; no flags/whitespace/digests) — enforced by zod **and** the service guard. Errors: **400 `SANDBOX_TEMPLATE_UNSAFE`** |

---

### Background-only surfaces (no HTTP route)

The worker (`apps/api/src/worker.ts`) consumes the `job_queue` table:
`JD_GENERATION`, `SAMPLES_GENERATION`, `POOL_SEAL`, `EVALUATION`. There is no
API to poll it directly — progress is observed through the resources above
(`jd.jdStatus`, `blueprint/samples`, `pool.hasActivePool`, the X-ray).

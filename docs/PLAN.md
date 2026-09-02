# ProvaHR

**The AI-native, open-source hiring platform — now mobile-native too.**
AI works for the HR team — writing job descriptions, generating tests, evaluating
submissions. Candidates prove their skill with their own brain — on web or
their phone — while the platform watches for AI cheating. Hiring runs on
proof, not polish.

> Status: **v1 + v2 (SaaS platform) COMPLETE — founder demo ready** · Last updated: 2026-08-31
>
> This document supersedes the earlier generic-ATS plan. Product decisions in
> §12 were confirmed by the founder on 2026-08-28 (D11 name locked, D13–D14
> added same day).

---

## 1. Vision & thesis

Hiring is asymmetric today: candidates weaponize AI (generated resumes, ChatGPT
take-homes) while HR teams drown in polished, indistinguishable applications.
Meanwhile enterprise ATS + assessment tools cost tens of thousands and lock
companies in.

**ProvaHR flips the asymmetry:**

- **AI leverage for HR** — describe the person you want (a LinkedIn link, a
  screenshot, a few sentences); the platform drafts the JD, generates the test,
  runs the sandbox, and evaluates the answers.
- **Proof over polish for candidates** — candidates take a real, role-specific
  test in a proctored browser session. Their code runs in a sandbox. LLM
  evaluation decides correctness, quality, and honesty.
- **The evaluation is asymmetric by design** — candidates see "submitted";
  HR sees an X-ray: code, execution output, per-answer verdicts, AI-suspicion
  signals, and structured recommendations.
- **Open and sovereign** — Apache-2.0, self-hosted, single company per install,
  bring-your-own LLM (OpenAI-compatible, Anthropic, or your own Azure tenant).
  Candidate data never leaves the company's infrastructure.

**One sentence:** *The first hiring platform where AI does the grunt work for
HR — and does the candidate's work for nobody.*

## 2. Non-negotiable principles

1. **Flag, never auto-reject.** AI suspicion is a signal for a human, never a
   decision. No automated rejections exist anywhere in the system.
2. **Humans decide.** Every pipeline advance/reject action is a human click.
   AI recommends; humans choose.
3. **Proof over polish.** Assessment results and sandbox execution are the core
   evidence — resumes are context, never the verdict.
4. **Candidate dignity.** The proctoring scope is disclosed *before* the test
   starts (a plain-language consent screen: tab-switch detection, paste
   detection, timing analysis — and explicitly *no* webcam, *no* screen
   recording in v1). Data minimization: we collect what the process needs.
5. **Sovereignty.** Self-hostable, single-tenant, BYO LLM keys, data stays on
   the company's infrastructure.
6. **Boring, proven tech.** TypeScript end-to-end, PostgreSQL, Docker.
   Contributors over cleverness.

## 3. Users & roles

| Persona | Role | What they do |
|---|---|---|
| IT / Ops admin | `ADMIN` | Configure LLM providers (OpenAI-compatible / Anthropic / **Azure OpenAI with the company's own tenant**), manage users, seal/regenerate question pools, run the install |
| HR / Recruiter | `RECRUITER` | Role intake (profile → JD), design test blueprints, publish roles, review evaluations, run the pipeline |
| Interviewer | `INTERVIEWER` | Post-test interviews, scorecards |
| Candidate | *(no account)* | Applies via public link, takes the test via a one-time email-verified link, sees only "submitted" |

**Single company per install** (confirmed). Multi-company SaaS is explicitly
out of scope for v1 — it keeps LLM key management and data isolation simple and
honest. The data model keeps a Company entity so multi-tenancy can be revisited
later without a migration.

## 4. The core loop

```
┌─ 1. ROLE INTAKE ────────────────────────────────────────────────────┐
│ HR: "I want someone like ___"                                        │
│   inputs: profile URL(s) + profile screenshot(s) + free-text notes   │
│ platform: fetches public web pages (personal site, GitHub, blog —    │
│   best-effort enrichment), sends screenshots + fetched text to LLM   │
│ output: draft JD grounded in the referenced person's actual role     │
│ HR edits & approves → role is created                                │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 2. TEST BLUEPRINT + SEALED POOL ───────────────────────────────────┐
│ HR designs the BLUEPRINT (topics, type mix, difficulty, count, time) │
│ LLM generates a SEALED question pool server-side — ≥6× the draw     │
│ size, encrypted at rest, invisible to every user (incl. HR/admin)   │
│ HR reviews only SAMPLE items (never drawn into real sessions)       │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 3. PUBLISH & APPLY ─────────────────────────────────────────────────┐
│ Public role page → candidate applies (profile + links, no account)   │
│ Platform issues a one-time test link (email-verified token,          │
│ time-boxed, single use)                                              │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 4. PROCTORED TEST SESSION (web + native mobile) ────────────────────┐
│ Random draw + per-session VARIANTS (different data/scenario/options) │
│ Question formats: SWIPE MCQ (like/dislike each option — mobile-     │
│   native gesture), classic MCQ, written, code/bash                  │
│ Linear one-question-at-a-time flow + bounded REVIEW PASS before     │
│ final submit: candidates may replay/re-like/revise any question     │
│ while the clock keeps running                                       │
│ Browser/app signals captured: tab-switch or app-background, large   │
│ paste events, keystroke cadence, time-per-question, copy events     │
│ Consent screen up front; NO webcam / screen recording in v1         │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 5. SANDBOX EXECUTION ───────────────────────────────────────────────┐
│ Code/bash answers run in ephemeral containers:                       │
│   network disabled · non-root · read-only fs · CPU/mem/wall-clock    │
│   limits · output caps · destroyed after the run                     │
│ Graded against HIDDEN test cases (candidate never sees them)         │
│ Captured: stdout, stderr, exit code, duration                        │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 6. LLM EVALUATION ──────────────────────────────────────────────────┐
│ Per answer: correctness verdict (run results + rubric),              │
│ quality review (for code), AI-likelihood assessment                  │
│ (LOW / MEDIUM / HIGH + reasoning) combining behavioral signals       │
│ Session rollup: score, strengths/gaps, structured recommendation     │
└──────────────────────────────────────────────────────────────────────┘
                              ↓
┌─ 7. ASYMMETRIC OUTCOME ──────────────────────────────────────────────┐
│ CANDIDATE SEES: "Submitted ✓" — nothing else, ever                   │
│ HR SEES: X-ray — every answer, every run, every signal, every        │
│ verdict, AI flags — then moves the candidate through the human       │
│ pipeline: Applied → Test → Review → Interview → Offer → Hired        │
└──────────────────────────────────────────────────────────────────────┘
```

## 5. Question integrity — the "bulletproof" pool

Cheating must be structurally hard, not just discouraged. The design principle:
**no human — including the company's own HR — can know which questions a
candidate will get.** A question can't be leaked by anyone inside the company
if nobody inside the company can enumerate it; and if every candidate gets a
different variant, sharing answers between candidates is useless.

### 5.1 Blueprint vs. pool vs. items (separation of concerns)

| Layer | Who sees it | What it is |
|---|---|---|
| **Test blueprint** | HR creates & edits | *What* the test covers: topics, question-type mix (MCQ/written/code), difficulty distribution, count per section, time limit, weights. Derived from the approved JD. **Contains zero questions.** |
| **Sealed question pool** | **Nobody.** Generated server-side by the LLM from the blueprint, encrypted at rest, exposed by **no API endpoint to any user role**. Only the worker can read it. | A large pool (≥6× the draw size per section) with variant-parameterized items + hidden test cases for code tasks. |
| **Session items** | Candidate (during their session only); HR **after** the session is submitted (audit view) | The random draw + variant realized at session start. |

HR controls quality through a **sample preview**: the LLM generates 3–5 example
items at blueprint-edit time (flagged as samples, never drawn into sessions).
HR approves the blueprint, not the items. Pool re-sealing is a one-click admin
action that destroys the old pool — even a stolen database dump ages out of
usefulness.

### 5.2 Mechanisms (defense in depth)

1. **Per-session random draw** from a pool ≥6× the test size.
2. **Variant generation at draw time** — each drawn item is re-parameterized
   for the session: different scenario data, different log-file contents,
   different constants, reordered MCQ options. Two candidates tested on the
   same concept see different concrete tasks. Near-identical answers across
   sessions ⇒ collusion flag in evaluation.
   *Status honesty (QA wave-6 F1):* v1 (Phase 5) ships **order-only**
   variants — prompt/option *text* is invariant. With the ≥6× pool the two
   sessions' draws overlap only at chance rate, but for a *shared* item,
   text-based answer-sharing still works. Scenario/data variants land with
   the sandbox phase; do not advertise mechanism 2 in full before then.
3. **Hidden test cases for code/bash** — the sandbox grades against unseen
   inputs (candidate sees only visible examples, like real CI). A memorized
   or ChatGPT'd answer must still *execute correctly* against cases it has
   never seen.
4. **Linear flow + bounded review pass** — questions are served
   one-at-a-time in randomized order (no single screenshot captures the
   test), and a single review pass before final submission lets the candidate
   revisit, replay, and revise answers (including re-liking/re-disliking
   swipe-MCQ options). The hard clock never pauses, so harvesting all items
   consumes the same bounded, signal-monitored time budget.
5. **Hard time budget** — the blueprint's total time limit is tuned so that
   consulting an LLM for every question is not physically possible within the
   clock. A well-timed test beats any detector.
6. **Leak traceability** — variants are per-session, so a question appearing
   on an external site identifies *which session* leaked it.
7. **Post-hoc human review with void power** — after sessions are submitted,
   HR audits items; a flawed generated question can be **voided across all
   sessions** with automatic score re-normalization. Fairness requires that a
   bad generated question never silently penalize candidates.

### 5.3 Trade-off accepted

Per-session *fresh* LLM generation (no pool at all) would be marginally harder
to leak, but session start would take 30–60s+, cost more tokens, and ship items
no human ever sanity-checked. The sealed-pool + variant design gives the same
leak-proof property (nobody can enumerate future items) with instant session
starts and better quality control.

## 6. v1 scope

**In:**
- Role intake from profile URL + screenshots + notes → AI-drafted JD (HR edits)
- Test blueprint editor (HR) + sealed pool generation + sample preview + re-seal
- Question formats: **Swipe MCQ** (per-option like/dislike), classic MCQ,
  short written, code/bash
- Public role page, application flow, one-time email-verified test links
- **Candidate test portal on web and native mobile (React Native + Expo)**
- Proctored session: variant draw, linear flow + review pass (revise/replay
  per question), hard clock, passive signals (tab-switch / app-background,
  paste, cadence, timing)
- Docker-based sandbox execution with hidden test cases for code/bash answers
- LLM evaluation: per-answer verdicts + quality + AI-likelihood; session rollup;
  cross-session collusion detection (identical-variant answers)
- HR evaluation X-ray view + item audit + void-with-renormalization;
  candidate sees only submission status
- LLM provider admin: OpenAI-compatible / Anthropic / Azure OpenAI (own tenant),
  one active provider, keys encrypted at rest
- Full pipeline tracking (jobs → applications → stages → interviews → scorecards),
  dashboard with funnel + flags
- Seed data + Docker Compose one-command deploy

**Out (roadmap):** webcam/screen proctoring · multi-tenant SaaS · native HR/
admin mobile app (HR console is responsive web in v1) · resume file parsing
beyond screenshots · email notifications beyond the test link · offer
management/e-sign · SSO · calendar integration · Bedrock/Vertex providers ·
automated external-leak scanning · question sharing between installs.

## 7. Architecture

```
                       ┌────────────────────────────┐
                       │  apps/web (React + Vite)   │
                       │  HR app · public board ·   │
                       │  candidate test portal     │
                       └─────────────┬──────────────┘
                       ┌─────────────┴──────────────┐
                       │  apps/mobile (React Native │
                       │  + Expo) — candidate app:  │
                       │  browse · apply · consent ·│
                       │  swipe-MCQ test session    │
                       └─────────────┬──────────────┘
                                     │ REST /api (same contract)
                       ┌─────────────▼──────────────┐
                       │  apps/api (Node + TS)      │
                       │  auth · roles · blueprints │
                       │  sessions · pipeline ·     │
                       │  admin/llm providers       │
                       └───┬──────────────┬─────────┘
                           │              │ enqueues jobs
                  ┌────────▼───────┐  ┌───▼──────────────────┐
                  │  PostgreSQL    │  │ apps/worker (Node)   │
                  │  (Prisma)      │  │ · LLM: JD gen, pool  │
                  │  + jobs table  │  │   gen, variants,     │
                  │  (DB queue v1) │  │   grading, collusion │
                  │  + sealed pool │  │ · sandbox execution  │
                  │  (encrypted)   │  │   (Docker, pluggable)│
                  └────────────────┘  └───┬──────────────────┘
                                          │
                              ┌───────────▼───────────────┐
                              │ LLM PROVIDER ABSTRACTION  │
                              │ OpenAI-compatible │ Anthropic │
                              │ Azure OpenAI (own tenant) │
                              │ → also unlocks Ollama,    │
                              │   vLLM, OpenRouter, etc.  │
                              └───────────────────────────┘
```

Key choices:

- **TypeScript end-to-end** (confirmed). Monorepo: `apps/api`, `apps/web`,
  `apps/worker`, `apps/mobile`, `packages/shared` (types/DTOs + the session
  client shared by api, web, worker, and mobile). *Phase 2 note:* the worker
  ships as a second entrypoint inside `apps/api` (`dist/worker.js` — same
  image, different CMD) until it outgrows the process; `apps/worker` remains
  the promotion target.
- **Identity = Keycloak (D15).** Organization users authenticate against
  Keycloak (OIDC); the API verifies RS256 tokens against the realm JWKS and
  maps realm roles to ProvaHR roles. Companies attach their own Azure AD /
  SAML / LDAP via Keycloak identity brokering — ProvaHR never becomes an IdP
  itself. Local dev-mode (password JWT) stays for contributor ergonomics.
  Candidates are not in Keycloak (one-time test tokens, PLAN §4).
- **Bootstrap = CLI script + web wizard (D16).** `install.sh` / `install.cmd`
  handle the boring parts (prereqs, deps, migrations); a first-run wizard at
  `/setup` creates the **super admin** and then hard-locks (companies are created in the platform console — D18)
  files hand-edited on day one.
- **Mobile = React Native + Expo** (confirmed): keeps TypeScript everywhere,
  shares `packages/shared` and the exact same session contract as the web
  portal, and Expo gives OSS contributors a one-command dev setup. The
  candidate experience is mobile-first — Swipe MCQ is a native gesture
  (like/dislike cards); on web the same interaction is tap-to-like/dislike
  buttons. The HR/admin console stays responsive web in v1; a native HR app is
  roadmap.
- **Signal parity across platforms**: on mobile, app-background/foreground
  lifecycle events are the equivalent of tab-switch/blur; paste, copy, and
  timing signals are captured identically via the shared session client in
  `packages/shared`, so web and mobile sessions produce comparable evidence.
- **DB-backed job queue for v1** (a `jobs` table + worker polling) — no Redis
  dependency; async LLM/sandbox work must survive restarts. Redis/BullMQ is a
  later optimization, hidden behind a queue interface.
- **Sealed pool storage**: pool contents encrypted at rest (`SECRETS_KEY`),
  read only by the worker process; the API layer has no route that returns
  unsealed items for future sessions.
- **Sandbox executor is a pluggable interface.** v1: Docker per-run with the
  hardening list in §10. v2+: external execution providers.
- **LLM provider abstraction**: one interface (`chat`, `chatWithImages`),
  three adapters, admin-configured via UI, exactly one active. Provider config
  (incl. API keys) encrypted at rest; keys never reach the browser, never
  appear in logs.

## 8. Data model (summary)

Survives from the existing scaffold (rescoped where noted): `Company` (single
row per install) · `User` (+roles) · `Candidate` · `Application` · `StageEvent`
(append-only audit) · `Interview` · `Scorecard` · `Job` (extended).

New entities:

| Entity | Purpose |
|---|---|
| `LlmProvider` | Admin config: kind (OPENAI_COMPATIBLE / ANTHROPIC / AZURE_OPENAI), baseUrl, encrypted apiKey, model names (text + vision), `isActive` |
| `Job` extensions | `jdSource`: input URLs[], screenshots[], notes, fetched text; `jdDraft` + approval status |
| `TestBlueprint` | Per job: sections, topics, **format mix (SWIPE_MCQ / MCQ / WRITTEN / CODE)**, difficulty distribution, counts, time limit, weights — **no questions** |
| `SealedQuestionPool` | Per job + blueprint version: encrypted blob of items. Each item carries format, prompt, options (each option has a truth flag for SWIPE_MCQ), rubrics, variant parameters, hidden test cases, expected behavior; `sealedAt`, `version` |
| `SampleItem` | Preview-only items shown to HR at blueprint-edit time; excluded from draws by construction |
| `TestSession` | Candidate + job + one-time token hash, issuedAt/expiresAt, startedAt, submittedAt, status, seeded variant nonce |
| `SessionQuestion` | The drawn items: pool item ref, realized variant, order, firstSeenAt, revisions count; **candidate-visible surface ends here** |
| `Answer` | Per session question: content/code (WRITTEN/CODE) **or per-option valuations `{optionId: LIKE \| DISLIKE}` (SWIPE_MCQ) or selected option(s) (MCQ)**; submittedAt, revision history — final state counts, revisions feed timing signals |
| `ExecutionResult` | Per code answer: stdout, stderr, exit code, hidden-case results, durationMs, truncated flag |
| `SessionSignal` | Proctoring events: TAB_SWITCH, BLUR, LARGE_PASTE, COPY, cadence summaries, time-per-question |
| `Evaluation` | Per answer: verdict (CORRECT/PARTIAL/INCORRECT), score, quality notes, aiLikelihood (LOW/MED/HIGH) + reasoning + model used — HR-only |
| `SessionAssessment` | Rollup: total score, strengths, gaps, recommendation, flag summary, collusion flags — HR-only |
| `VoidedItem` | Admin/HR void of a pool item across sessions → triggers score re-normalization |

## 9. API surface (as implemented — mirrored from the routers; full reference: docs/API.md)

```
# Health & first-run setup (public; install hard-locks after first success)
GET    /health
GET    /api/setup/status                   # boolean install state
GET    /api/setup · /setup                 # first-run wizard page (+ /api/setup/wizard.js)
POST   /api/setup/install                  # super admin bootstrap (10/hour/IP)

# Auth & users (local mode; Keycloak mode = docs/RBAC.md)
POST   /api/auth/register                  # super-admin bootstrap (409 once installed; superseded by D18)
POST   /api/auth/login                     # email + password → JWT
GET    /api/auth/me                        # current user
GET    /api/users                          # list company users (auth)
POST   /api/users                          # add team member (ADMIN)

# Admin — LLM providers (ADMIN; keys redacted, AES-256-GCM at rest)
GET    /api/admin/llm-providers            # list (redacted — last-4 only)
POST   /api/admin/llm-providers            # add provider config
PATCH  /api/admin/llm-providers/:id        # update (apiKey absent = keep)
POST   /api/admin/llm-providers/:id/activate # exactly one active (atomic)
POST   /api/admin/llm-providers/:id/test   # live connectivity smoke test
DELETE /api/admin/llm-providers/:id

# Jobs CRUD + role intake → JD (ADMIN/RECRUITER; company-scoped)
GET    /api/jobs                           # list (filters: status, roleFamily, q)
POST   /api/jobs                           # create
GET|PATCH|DELETE /api/jobs/:jobId          # detail / update / delete
POST   /api/jobs/:jobId/status             # publish (OPEN) / pause / close
GET    /api/jobs/:jobId/applications       # pipeline board (auth)
POST   /api/jobs/intake                    # URLs + screenshots + notes → JD job (16mb limit)
GET    /api/jobs/:jobId/jd                 # generation status + draft
PATCH  /api/jobs/:jobId/jd                 # HR edits the draft (JD_REVIEW only)
POST   /api/jobs/:jobId/jd/approve         # draft fields copied onto the job

# Test blueprint & sealed pool (ADMIN/RECRUITER, on the jobs spine)
PUT    /api/jobs/:jobId/blueprint          # create/edit blueprint (needs approved JD)
GET    /api/jobs/:jobId/blueprint          # blueprint + pool counts
POST   /api/jobs/:jobId/blueprint/samples  # queue sample preview items (202)
GET    /api/jobs/:jobId/blueprint/samples  # preview items (never drawn)
POST   /api/jobs/:jobId/pool/seal          # generate + seal pool (202, worker)
POST   /api/jobs/:jobId/pool/reseal        # destroy old pool now + regenerate
GET    /api/jobs/:jobId/pool               # counts ONLY — never items
# NOTE: no endpoint anywhere returns unsealed future-session items.

# Public / candidate (no account; web + mobile share this contract)
GET    /api/public/jobs                    # board (OPEN jobs, testRequired flag)
GET    /api/public/jobs/:jobId             # public detail
POST   /api/public/jobs/:jobId/apply       # application + one-time test-link token (20/min/IP)
GET    /api/public/test/:token             # consent meta (uniform 404, never items)
POST   /api/public/test/:token/start       # draws items + variants, starts clock (201/200)
GET    /api/public/test/:token/session     # refresh-safe session view
POST   /api/public/test/:token/answers     # upsert one answer (swipe/mcq/text shapes)
POST   /api/public/test/:token/signals     # batched proctoring evidence
POST   /api/public/test/:token/submit      # finalize → { submitted: true } only

# HR — pipeline, X-ray, void, interviews, stats (auth)
GET    /api/applications/:id               # detail + history + interviews + scorecards
GET    /api/applications/:id/xray          # answers, runs, signals, evaluations (post-submission only)
PATCH  /api/applications/:id/stage         # human pipeline move (validated)
POST   /api/applications/:id/status        # reject (reason required) / withdraw / reopen
POST   /api/applications/admin/items/:itemId/void  # (ADMIN) void item across sessions + re-normalize
GET|POST /api/applications/:id/interviews  # list / schedule (ADMIN/RECRUITER)
PATCH  /api/interviews/:id                 # reschedule / reassign / status
POST   /api/interviews/:id/scorecard       # submit scorecard (any company member)
GET    /api/stats                          # dashboard aggregates
```

## 10. Fairness, privacy & security commitments

- **Flag, never auto-reject** (§2.1) enforced in code: no code path can set a
  rejection from an AI verdict; rejections are human actions requiring a reason.
- **Proctoring disclosure**: test start requires an explicit consent screen
  listing exactly what is monitored and what is not (no webcam/screen recording
  in v1 — and if ever added, it becomes a separately consented, per-install
  opt-in).
- **Candidate data minimization & erasure**: `Candidate` is a first-class
  entity; deletion cascades. Sandbox artifacts destroyed after evaluation.
  Signal data has a retention window (configurable, default 12 months).
  Intake screenshots (captures of referenced professionals' public profiles)
  are candidate-adjacent personal data: stored per-install, deleted with the
  job row, never echoed back by any API, and get an explicit retention window
  + erasure endpoint in the Phase 10 hardening pass.
- **Sandbox hardening (v1 Docker)**: network disabled; non-root user; read-only
  rootfs with tmpfs workspace; CPU / memory / wall-clock limits; output size
  caps; container destroyed immediately after the run; no host mounts; image
  allow-list per language (bash, node, python v1).
- **Key handling**: provider API keys and sealed pool contents encrypted at
  rest (`SECRETS_KEY` env), redacted in every API response and log line.
- **Auth**: bcrypt passwords, JWT sessions, helmet, CORS allow-list, rate
  limiting on public endpoints (apply + test session).
- **LinkedIn reality**: we do not ship a LinkedIn crawler (ToS + legal risk for
  an OSS project). Screenshot ingestion (vision LLM) is the primary path;
  public-URL fetching is best-effort enrichment only, clearly labeled as such.

## 11. Delivery plan

| Phase | Deliverable | Depends on |
|---|---|---|
| 0 | Repo restructure to monorepo, Apache-2.0 switch, plan sign-off | — |
| 1 | LLM provider abstraction + admin CRUD + connectivity test | 0 |
| 1a | **Keycloak RBAC:** OIDC dual-mode auth middleware, role mapping, realm export, Azure AD brokering docs | 0 *(parallel track)* |
| 1b | **Setup & deploy:** install.sh/cmd, first-run web wizard, docker-compose (db + Keycloak + API), API Dockerfile, CI | 0 *(parallel track)* |
| 2 | Role intake → JD generation (screenshot + URL fetch + LLM) with HR edit loop | 1 |
| 3 | Blueprint editor + sample preview + sealed pool generation (+re-seal) | 2 |
| 4 | Public board, apply flow, one-time test links | 2 |
| 5 | Candidate test portal (web): consent, draw+variants, swipe-MCQ + formats, review pass, clock, signal capture | 3, 4 |
| 6 | Candidate mobile app (Expo): browse, apply, consent, swipe-gesture test session, signal parity | 5 |
| 7 | Sandbox executor (Docker) + hidden test cases + execution results | 5 |
| 8 | LLM evaluation pipeline (verdicts, AI-likelihood, collusion) + HR X-ray + void | 7 |
| 9 | Pipeline integration (stages extended with Test/Review) + dashboard + flags | 8 |
| 10 | Hardening: rate limits, key+pool encryption, retention, docs, seed, Compose deploy | all |

Phases 1–3 are demoable standalone; 4–8 form the candidate loop (mobile in 6);
9 ties it into the full ATS spine (already scaffolded and tested).

## 12. Decision log (founder-confirmed 2026-08-28)

| # | Decision | Choice |
|---|---|---|
| D1 | Product thesis | AI-native hiring: AI for HR, proof-over-polish for candidates, AI-usage detection as the differentiator |
| D2 | AI-cheating policy | **Flag for human review — never auto-reject** |
| D3 | Detection depth v1 | Passive signals + post-hoc LLM analysis; **no webcam/screen recording** |
| D4 | Test formats v1 | **Swipe MCQ (per-option like/dislike)** + classic MCQ + written + code/bash; per-candidate randomization; bounded review pass with per-question revise/replay |
| D5 | Evaluation visibility | Candidate: submission status only. HR: full X-ray incl. code, runs, signals, AI verdicts |
| D6 | Tenancy | Single company per install; admin connects own LLM incl. **own Azure OpenAI tenant**. *Superseded in part by D18 (2026-08-29): the install is a multi-company platform; the admin-owns-the-LLM aspect lives on per tenant (D20)* |
| D7 | Stack | **TypeScript end-to-end** (Node API + worker, React web) |
| D8 | License | **AGPL-3.0-only** (founder switch from Apache-2.0, 2026-09-02: keeps SaaS forks open) |
| D9 | LLM providers v1 | OpenAI-compatible + Anthropic + Azure OpenAI; one active; admin-configured |
| D10 | Sandbox v1 | Docker per-run, pluggable executor interface. *Superseded in part by D21 (2026-08-31): per-company image templates are allowed; the hardening flags stay platform-fixed* |
| D11 | Name | **ProvaHR** (locked 2026-08-28; no exact-match collisions found — formal domain/trademark clearance before public launch) |
| D12 | Question integrity | **"Bulletproof" pool: HR designs blueprint only; sealed pool (encrypted, no API exposure to any role); per-session draw + variants; hidden test cases; hard time budget; post-hoc void with score re-normalization** |
| D13 | Mobile | **Native candidate app: React Native + Expo** (TypeScript preserved; same API contract; swipe gestures for Swipe MCQ; signal parity with web). HR console = responsive web in v1 |
| D14 | Swipe MCQ | Mobile-native question format: question shown, multiple options presented as cards — candidate likes/dislikes each; per-question replay and answer changes during the bounded review pass; scored per option against truth flags (partial credit) |
| D15 | RBAC / identity | **Keycloak** is the identity provider for organization users: API validates OIDC JWTs (RS256, issuer + audience checked), maps realm/client roles to ADMIN/RECRUITER/INTERVIEWER, auto-provisions the local user row on first login. Organizations federate **their own Azure AD / SAML / LDAP through Keycloak identity brokering**. A local dev-mode (email/password JWT) remains so contributors run without Keycloak. Candidates never touch Keycloak — one-time test tokens stay internal |
| D16 | Setup & install | **Minimal first-run path:** `scripts/install.sh` (bash) + `scripts/install.cmd` (Windows) check prerequisites, install deps, prepare `.env`, run migrations; then a **web-based setup wizard** (`GET /setup`) bootstraps the install (company + first admin; the wizard shows which auth mode is active — mode itself is environment-configured per D15, see `docs/RBAC.md`) and locks itself afterwards. Full stack ships via `docker compose up` (db + Keycloak + API) |
| D17 | Integration discipline | Subsystem agents develop in parallel under **disjoint file ownership**; integration is **serial through the orchestrator**, who runs typecheck/tests/docs gates before any subtask is marked done. Independent **QA agent waves** audit landed work against spec + the never-regress list (docs/TESTING.md §6) |
| D18 | **SaaS multi-tenancy** (founder, 2026-08-29 live-test) | The install becomes a PLATFORM: the setup wizard initializes a **Super Admin only**; companies (tenants) are created via a wizard inside the Super Admin panel. Supersedes the single-company aspect of D6 (the Company entity was already kept multi-ready). Role `SUPER_ADMIN` added; company users unchanged |
| D19 | **Runtime auth configuration** (founder) | Auth mode + Keycloak settings become DATA, not env: a platform settings row plus per-company Keycloak config (issuer/audience), switchable in the portal. Env vars remain boot-time fallbacks. The "edit .env and restart" answer is retired |
| D20 | **Company-scoped LLM providers** | LlmProvider gains `companyId`; each tenant configures its own provider keys. Platform-level defaults may come later |
| D21 | **Company-scoped sandbox templates** | Tenants define sandbox image templates per language (e.g. a Java exercise image), stored per company; the builder's image allow-list resolves company template → platform default. Supersedes the global allow-list aspect of D10 |

## 12.1 v2 delivery plan (SaaS evolution — appended 2026-08-29)

**v2 COMPLETE (2026-08-31).** Every wave shipped with tests, a live E2E
regression pass and a git checkpoint; suite at close: 483 passed + 16
CI-gated = 499.

| Phase | Deliverable | Status |
|---|---|---|
| V2-1 | Multi-tenant core: `SUPER_ADMIN` role, nullable `User.companyId`, `PlatformSettings` (runtime auth mode), migration 0002, company CRUD (SUPER_ADMIN-gated), wizard v3 (super admin only) | ✅ 2026-08-29 |
| V2-2 | Company-scoped LLM providers (`companyId` on LlmProvider + migration 0003 index swap + tenancy scoping + per-company admin UI) | ✅ 2026-08-29 |
| V2-3 | Runtime Keycloak: per-company OIDC config (`CompanyAuthConfig`, migration 0004), portal switch, middleware multi-issuer resolution, super-admin lockout carve-out + `SSO_MODE_ACTIVE` | ✅ 2026-08-31 |
| V2-4 | Sandbox templates: company-scoped image templates (migration 0005) + parameterized exact-prefix builder integration | ✅ 2026-08-31 |
| V2-5 | Docs sweep: BIBLE/RBAC/SELF_HOSTING/API/DATA_MODEL/PLAN/README/PROGRESS reconciled to the platform model | ✅ 2026-08-31 |

## 13. What survives from the current scaffold

The generic-ATS code built earlier becomes the **tracking spine**: auth +
roles/RBAC, users, jobs CRUD, applications pipeline + stage rules (extended
with TEST/REVIEW stages), interviews, scorecards, stats, tests, Docker files.
Docs and license are rewritten/replaced. Frontend pages are retained where
they map (pipeline, dashboard, login) and rebuilt around the new flows.

## 14. Naming — ProvaHR ✅

**Locked 2026-08-28.** "Prova" = test/proof in Italian and Portuguese — the
product in two syllables; "HR" says exactly who it serves. Web search found no
exact-match company (nearest neighbors: a Utah "Prova" assessment startup and
an education "Prova AI" — different names, same word worth watching).
Formal clearance (domain + trademark + GitHub org/repo) happens before public
launch; renaming the repo pre-launch is free.

## 15. Open-source mechanics

- **License:** Apache-2.0 (with NOTICE file).
- **Contributing:** fork + PR, conventional commits, tests required for logic
  changes; `good first issue` labels; ADR-style decision log in this doc.
- **CoC:** Contributor Covenant 2.1. **Security:** private disclosure policy.
- **CI:** GitHub Actions — typecheck + unit tests per package; Docker build
  smoke test; sandbox hardening lint (no `--privileged`, no host network).

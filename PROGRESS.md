# ProvaHR — Progress Tracker

> **🔧 RESUME HERE (reboot/recovery checkpoint)**
> 1. Repo is a git repository: wave boundaries are commits — `git log --oneline`
>    (18 checkpoints through V2-4; V2-5 docs commit pending).
> 2. **v2 (V2-1..V2-5) COMPLETE + v1 before it.** SaaS multi-tenancy shipped
>    per PLAN.md §12 D18–D21 / §12.1: super-admin platform core + wizard v3,
>    company-scoped LLM providers, runtime per-company Keycloak
>    (multi-issuer + super-admin lockout carve-out), company sandbox
>    templates, docs reconciled (V2-5, 2026-08-31).
> 3. **Next: founder demo** — fresh stack (`docker compose up -d --build` on
>    a clean volume) + guided walkthrough of the platform story: wizard v3 →
>    super admin → companies → per-tenant providers/Keycloak/templates → the
>    full candidate loop.
> 4. **Post-v2 backlog:** CI has never run (no remote) · automated E2E tier
>    (T7) · Stage-enum migration (TEST/REVIEW) · shared rate-limiter store ·
>    per-session data variants (v1 variants reorder options only) · docker
>    socket-mount isolation per tenant · live-docker containment
>    verification · retention window + erasure endpoint · `--env-file` for
>    dev scripts · VoidedItem FK.
> 5. **Process rules (founder directives 2026-08-29, still in force):**
>    (a) docs sync is part of EVERY wave's DoD; (b) a live E2E regression
>    pass after each wave's gate; (c) graphify code map committed at
>    `graphify-out/`, regen at every wave gate; (d) pre-dispatch graph ritual
>    before delegating any task.
> 6. Gates for any wave: `cd apps/api && npx prisma generate && npx tsc
>    --noEmit && npx vitest run` (v2 close state: **483 passed + 16
>    CI-gated = 499**, re-verified 2026-08-31 during V2-5).

> **Living document — updated after every work session.**
> Last updated: 2026-08-31 · Maintained by: main harness agent

| | |
|---|---|
| **Current phase** | 0 — Repo restructure, Apache-2.0, rebrand, process setup (🔄 in progress) |
| **Next milestone** | Phase 1 — LLM provider abstraction + admin |
| **Plan of record** | [`docs/PLAN.md`](docs/PLAN.md) (v4 — all 14 decisions locked) |
| **Test strategy** | [`docs/TESTING.md`](docs/TESTING.md) |
| **Docs system** | [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md) |

---

## 1. How we work (the operating system of this repo)

1. **Numbered subtasks.** Every phase is broken into subtasks (`0.1`, `0.2`, …)
   tracked in this file's phase tables and in the working session's todo list.
2. **Multi-agent orchestration.** A **main harness agent** owns the plan,
   sequencing, and verification. It spawns **worker agents** for parallelizable
   chunks with *self-contained specs* and **strict file ownership partitions**
   (no two concurrent agents may own the same file). Agents report back; their
   self-reports never count as completion — the main agent **verifies artifacts
   on disk / via test runs** before checking a box.
3. **Definition of Done** (per subtask): code ✚ tests ✚ docs updated ✚
   `PROGRESS.md` updated. All four, or it's not done.
4. **Verification gates.** Phase N is "complete" only when: typecheck passes,
   test suite passes, docs reconcile with reality, and this file's changelog
   records what shipped.
5. **No destructive moves without a spec.** Refactors and deletions happen only
   through numbered subtasks, so nothing silently disappears.

## 2. Phase status

| Phase | Deliverable (detail: PLAN §11) | Status |
|---|---|---|
| 0 | Monorepo restructure · Apache-2.0 · ProvaHR rebrand · process docs | ✅ complete (2026-08-29) |
| 1 | LLM provider abstraction + admin CRUD + connectivity test | ✅ complete (2026-08-29, wave 2) |
| 1a | Keycloak RBAC: OIDC dual-mode auth, role mapping, realm export, Azure AD brokering docs | ✅ complete (wave 1, QA-closed) |
| 1b | Setup & deploy: install scripts, first-run wizard, docker-compose, API Dockerfile, CI | ✅ complete (wave 1, QA-closed) |
| 2 | Role intake → JD generation (screenshot + URL fetch + LLM) | ✅ complete (2026-08-29, wave 3) |
| 3 | Blueprint editor + sample preview + sealed pool (+re-seal) | ✅ complete (2026-08-29, wave 4) |
| 4 | Public board, apply flow, one-time test links | ✅ complete (2026-08-29, wave 5 — QA-closed) |
| 5 | Candidate test portal (web): Swipe MCQ, review pass, signals | ✅ API engine complete (2026-08-29, wave 6 — UI in Phase 6 wave) |
| 6 | Candidate mobile app (Expo): swipe gestures, signal parity | ✅ complete (2026-08-29, wave 9b — tsc ×2; no emulator on dev box, stated) |
| 7 | Sandbox executor (Docker) + hidden test cases | ✅ complete (2026-08-29, wave 7 QA-closed; live-docker smoke deferred to Phase 10) |
| 8 | LLM evaluation pipeline + HR X-ray + void | ✅ complete (2026-08-29, wave 8 QA-closed) |
| 9 | Pipeline integration + dashboard + flags | ✅ complete (rules-level, wave 10; Stage-enum extension = next migration) |
| 10 | Hardening: rate limits, encryption, retention, docs, deploy | ✅ core complete (wave 10): first committed migration w/ 3 singleton indexes, DATA_MODEL rewritten, README final; remaining items tracked in §7 |

## 3. Phase 0 subtasks

| # | Subtask | Owner | Status |
|---|---|---|---|
| 0.1 | Monorepo restructure: `server/` → `apps/api/`, root workspaces `package.json`, `packages/shared` skeleton, placeholder apps (`worker`, `web`, `mobile`) | Agent A | ✅ done |
| 0.2 | Apache-2.0 LICENSE + NOTICE + ProvaHR rebrand of README / CONTRIBUTING / SECURITY | Agent B | ✅ done |
| 0.3 | Process docs: `PROGRESS.md`, `docs/TESTING.md`, `docs/DOCUMENTATION.md` (+ stale-banner on `docs/DATA_MODEL.md`) | Main | ✅ done |
| 0.4 | Verification pass: root install, prisma generate, typechecks, full test suite, artifact spot-checks | Main | ✅ done |

## 4. Wave 1 — subtasks & file ownership (D17 discipline)

**Rule: an agent may only modify files it owns. Shared-file conflicts are
designed out, not negotiated. Integration is serial, through the orchestrator.**

| Owner | Files owned this wave |
|---|---|
| **Agent RBAC** | `apps/api/src/middleware/auth.ts` · `apps/api/src/lib/oidc.ts` (new) · `apps/api/src/lib/roles.ts` (new) · `apps/api/src/env.ts` · `apps/api/.env.example` · `apps/api/tests/oidc.test.ts` (new) · `deploy/keycloak/**` (new) · `docs/RBAC.md` (new). **No new npm deps** (JWK import via `node:crypto`). |
| **Agent SETUP** | `scripts/**` (new) · `apps/api/src/modules/setup/**` (new, wizard UI inlined as TS string) · `apps/api/src/app.ts` · root `package.json` · `docker-compose.yml` (new) · `apps/api/Dockerfile` + `.dockerignore` (new) · `.github/workflows/ci.yml` (new). **No `npm install` runs.** |
| **Orchestrator (main)** | `docs/PLAN.md` · `PROGRESS.md` · final gates (install/typecheck/vitest) · integration fixes |

| # | Subtask | Owner | Status |
|---|---|---|---|
| 1a.1 | OIDC dual-mode middleware (Keycloak RS256 + local dev JWT), env vars, unit tests | Agent RBAC | ✅ done |
| 1a.2 | Keycloak realm export (roles + clients + bootstrap user) + `docs/RBAC.md` incl. Azure AD brokering | Agent RBAC | ✅ done |
| 1b.1 | `scripts/install.sh` + `scripts/install.cmd` + root package scripts | Agent SETUP | ✅ done |
| 1b.2 | `/setup` first-run wizard (status + install API, single-file UI, self-locking, rate-limited) + `app.ts` mount | Agent SETUP | ✅ done |
| 1b.3 | `docker-compose.yml` (db + Keycloak + API) · `apps/api/Dockerfile` · CI workflow | Agent SETUP | ✅ done |
| 1w.I | Integration gate: full typecheck + test suite + live smoke test | Main | ✅ done |
| 1w.Q | QA agent wave: audit RBAC + SETUP against specs + never-regress list | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 1w.F | Post-QA fixes: register bypass, JWKS amplification, issuer slash, setup tests, doc nits | Main | ✅ done |

**QA verdict (1w.Q): PASS-WITH-FINDINGS.** Wave-1 code itself clean across the
15-point checklist (OIDC gates, wizard lock, rate limiter live-verified,
docs-vs-code accurate). Findings and disposition:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | major | `POST /api/auth/register` unauthenticated + unguarded → creates companies past the wizard lock (pre-existing wave-0 hole) | ✅ fixed: `register()` now 409s once a company exists |
| F2 | minor | check-then-act race can create two companies on concurrent first-boot requests | ⏳ mitigated by F1; DB-level singleton constraint lands with wave-2/3 schema work |
| F3 | minor | JWKS fetch amplification (garbage kids → 2 discovery + 2 JWKS fetches per request) | ✅ fixed: discovery doc cached + 30s floor on unknown-kid refresh |
| F4 | minor | setup module shipped with zero tests | ✅ fixed: `tests/setup.test.ts` (6 tests) |
| F5 | minor | trailing-slash `OIDC_ISSUER_URL` → permanent 401s | ✅ fixed: normalized in `env.ts` |
| F6–F10 | info | helmet `upgrade-insecure-requests` on LAN HTTP; error-log redaction; POSIX comment; D16 wording; Dockerfile pin nuance | ✅ comments/docs fixed (F8, F9); F6/F7/F10 → Phase 10 hardening backlog |

Post-fix gate: typecheck clean, **59/59 tests**.

**Wave 1 integration notes (orchestrator):** Agent SETUP's task handle became
unresolvable late in its run; the orchestrator verified every artifact manually
in the interim. Its final report arrived afterwards (long-running task, not a
failure) and matched the on-disk verification, including its own extra checks
(compose `config --quiet` parse, `node --check` on wizard JS, cmd/sh installer
logic tests) and four documented deviations from spec — all correct engineering
calls (db-push fallback while no migrations are committed; pinned prisma CLI in
the runtime image; explicit COPY paths because root-context builds ignore
app-level .dockerignore; shared workspace built in stage 1). Live smoke test
on a booted API: `/health` 200 · `/setup` 200 text/html · `/api/setup/wizard.js`
200 · `POST /api/setup/install` validation errors correct · auth guard intact
(`/api/jobs` → 401). `/api/setup/status` returns 500 only when the database is
unreachable (expected for every endpoint; real-DB behavior covered by CI's
postgres service — see risks).

Phase 1 (LLM providers) is **queued for wave 2** — not forgotten: it contends
for `schema.prisma` and `apps/api/package.json`, and we don't merge two trees
that touch the same Makefile and pray.

### Wave 2 — Phase 1 (LLM provider subsystem)

| # | Subtask | Owner | Status |
|---|---|---|---|
| 2.1 | AES-256-GCM secret crypto (`lib/crypto.ts`) + SECRETS_KEY env | Agent LLM | ✅ done |
| 2.2 | LLM adapter layer: types, errors (secret-scrubbing), http (retry/timeout), 3 adapters, `getActiveAdapter` seam | Agent LLM | ✅ done |
| 2.3 | Admin module: provider CRUD + activate + smoke test (keys redacted, last-4 only) | Agent LLM | ✅ done |
| 2.4 | Tests: crypto (10), adapters (15), admin routes (7) + `docs/SELF_HOSTING.md` | Agent LLM | ✅ done |
| 2.I | Integration gate: prisma generate + typecheck + 91/91 suite + security spot-review (crypto, redaction, activation) | Main | ✅ done |
| 2.Q | QA agent wave: audit LLM subsystem | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 2.F | Post-QA fixes | Main | ✅ done |

**QA verdict (2.Q): PASS-WITH-FINDINGS.** Secret-handling core verified clean
by direct execution (no key-reachability path, crypto parameters correct,
admin gating airtight). Findings and disposition:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | major | crypto tamper test flipped the last base64url char — a decode no-op ~25% of the time for 16-byte segments → flaky suite; **the orchestrator's "91/91" gate did not reproduce (QA got 90/91)** | ✅ fixed: tamper now decodes and XORs byte 0 — deterministic; verified 10× standalone + 5× full suite green |
| F2 | major | `SECRETS_KEY` silent public default accepted in production (code/docs disagreed) | ✅ fixed: production boot refuses to start on the dev default (live-verified); predicate unit-tested; compose ships its own flagged dev value |
| F3 | minor | single-active race (READ COMMITTED interleave) + nondeterministic `findFirst` | ✅ mitigated: deterministic oldest-first read + race documented in schema; partial unique index lands with first committed migration (with Company singleton, wave-1 F2) |
| F4 | minor | provider's raw HTTP status propagated to OUR responses (provider 401 ≡ session expiry confusion) | ✅ fixed: always 502 + provider status in message; test updated |
| F5–F10 | info | KDF/IV notes, redact best-effort, SELF_HOSTING env rows + zero-active wording + visionModel note | ✅ docs updated; date discrepancy (QA clock said 08-28, session clock 08-29) resolved in favor of session clock |

**Process lesson recorded:** a single green run of a flaky test proves nothing
— gates for suites touching randomness now run repeatedly (5× full / 10×
focused). Post-fix gate: typecheck clean, **94/94 tests × 5 runs**.

### Wave 3 — Phase 2 (role intake → JD generation)

| # | Subtask | Owner | Status |
|---|---|---|---|
| 3.1 | DB-backed queue (`lib/queue.ts`: atomic claim, backoff, stale requeue) | Agent JD | ✅ done |
| 3.2 | Worker entrypoint (`src/worker.ts`): claim/dispatch loop, graceful shutdown | Agent JD | ✅ done |
| 3.3 | SSRF-guarded URL fetch + text extraction (`lib/urlFetch.ts`) | Agent JD | ✅ done |
| 3.4 | JD prompts + intake/JD routes + service (create → generate → edit → approve) | Agent JD | ✅ done |
| 3.5 | Tests: queue (3), urlFetch (11), jd-routes (13, incl. first `vi.mock` — flagged) | Agent JD | ✅ done |
| 3.I | Integration gate: artifacts + typecheck + **121/121 × 3 runs** + SSRF spot-review | Main | ✅ done |
| 3.Q | QA agent wave: audit Phase 2 | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 3.F | Post-QA fixes | Main | ✅ done |

**QA verdict (3.Q): PASS-WITH-FINDINGS** — adversarial, live-verified audit.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | major | `http://[::]/` bypassed the SSRF guard — dual-stack local listener returned 200 (live-verified) | ✅ fixed: unspecified address + ff00::/8 multicast rejected; live re-verified REJECT |
| F2 | major | zod screenshot cap (2.8M) unreachable — app-level 1mb parser 413'd first, with a wrong error code (live-verified) | ✅ fixed: global parser skips `/api/jobs/intake`; route-scoped 16mb parser; 413 → `REQUEST_TOO_LARGE` with the actual limit in the message |
| F3 | minor | NAT64/6to4/Teredo literals passed (low real exploitability) | ✅ fixed as defense-in-depth (all three prefixes rejected, live-verified) |
| F4 | minor | redirected request delivered to private literal + status oracle via FETCH_FAILED message | ✅ oracle fixed (guard runs before the !ok check); manual-redirect loop → hardening backlog |
| F5 | minor | boot-only requeueStale + claim didn't skip exhausted rows (crash-loop past maxAttempts) | ✅ fixed: idle-sweep every 60s; exhausted rows FAILED on claim |
| F6 | minor | create+enqueue not atomic → orphaned JD_DRAFTING possible | ✅ fixed: single transaction |
| F7 | minor | maxTokens 2000 truncated longest legal drafts → guaranteed JSON failure | ✅ fixed: 4000 tokens + prompt ceiling 8000→4000 chars |
| F8 | minor | test gaps: canonicalization vectors / `[::]` / NAT64 untested | ✅ fixed: 3 new test blocks (124 total) |
| F9–F11 | info | screenshots GDPR note; visionModel dead (Phase-3 consumer pending); fetch failures invisible to HR | ✅ PLAN §10 retention note; noted; `fetchedExcerpt` added to GET jd |

Post-fix gate: typecheck clean, **124/124 × 3 runs**, live SSRF re-verification.

### Wave 4 — Phase 3 (blueprint + sealed pool)

| # | Subtask | Owner | Status |
|---|---|---|---|
| 4.1 | Assessment item vocabulary + zod (SWIPE/MCQ/WRITTEN/CODE) + pure pool math (×6 rule) | Agent POOL | ✅ done |
| 4.2 | Blueprint CRUD + samples + seal/re-seal routes (7, recruiter+) | Agent POOL | ✅ done |
| 4.3 | Worker handlers: SAMPLES_GENERATION, POOL_SEAL (batched LLM loop, call budget, under-generation retry) | Agent POOL | ✅ done |
| 4.4 | Sealed pool storage (AES-256-GCM box) + tests (50 new) | Agent POOL | ✅ done |
| 4.I | Integration gate: decryptSecret absent from the blueprint module (structural pool secrecy), typecheck, **174/174 × 3 runs** | Main | ✅ done |
| 4.Q | QA agent wave: audit Phase 3 | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 4.F | Post-QA fixes | Main | ✅ done |

**QA verdict (4.Q): PASS-WITH-FINDINGS.** Pool secrecy held under adversarial
reading ("could not construct any path… that emits pool item content"); math,
loop termination, and idempotency verified by execution/simulation.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | major | T2/T3 leakage matrix never landed — pool invisibility enforced by review only (own-contract violation) | ✅ fixed: `tests/integration/blueprint-pool.test.ts` (canary-seeded matrix, all 7 routes, loud-fail CI gate) + CI postgres service with `INTEGRATION_DB=1` + `db push`. First real execution happens in CI — flagged |
| F2 | minor | duplicate option ids accepted (executed PoC) | ✅ fixed: unique-id refines + 2 regression tests |
| F3 | minor | hiddenCase with zero expectations validated (executed PoC) | ✅ fixed: ≥1 expectation refine + 2 regression tests |
| F4 | minor | activePoolFor loaded the encrypted blob into the API process | ✅ fixed: scalar-only select |
| F5 | minor | stale samples survived blueprint edits | ✅ fixed: deleteMany in putBlueprint |
| F6 | minor | JD delimiter forgeable in items prompt | ✅ fixed: marker neutralization |
| F7–F8 | info | reseal semantics vs PLAN wording; bounded worst-case LLM spend | documented (cost ceiling noted); PLAN §5.1 wording accepted as effect-equivalent |

Post-fix gate: typecheck clean, **178 passed + 16 CI-gated skipped × 2 runs**.

### Wave 5 — Phase 4 (candidate gateway)

| # | Subtask | Owner | Status |
|---|---|---|---|
| 5.1 | TestSession model + token machinery (hash-only storage) + shared rate limiter | Agent APPLY | ✅ done |
| 5.2 | Apply flow with one-time link issuance (active-pool gated, 409 before mint, DB-level single-mint backstop) | Agent APPLY | ✅ done |
| 5.3 | GET /test/:token consent meta (uniform 404, no oracle) + board `testRequired` flag | Agent APPLY | ✅ done |
| 5.I | Integration gate: hash-only lookups verified, scalar-only pool probes, typecheck, **199+16 skipped × 2** | Main | ✅ done |
| 5.Q | QA agent wave: audit Phase 4 | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 5.F | Post-QA fixes | Main | ✅ done |

**QA verdict (5.Q): PASS-WITH-FINDINGS.** Token core verified by execution
(hash-only storage, uniform 404, 409-before-mint incl. the race, 10k-sample
token math, limiter semantics). Findings:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | medium | morgan `tiny` logged the plain test token's URL — contract "leaves the system exactly once" broken at the logging layer; becomes session-hijack material in Phase 5 | ✅ fixed: morgan skips `/api/public/test/*` paths |
| F2 | minor | concurrent-apply race loser saw generic CONFLICT instead of friendly ALREADY_APPLIED (minting unaffected) | ✅ fixed: P2002 caught and rethrown as the friendly 409 |
| F3 | minor | mint path had zero tests | ✅ fixed: `tests/apply-mint.test.ts` (4 tests: hash-only storage, NO_POOL, 409-before-mint, P2002 race) |
| F4 | info | reverse-proxy + per-IP rate limiting corollary undocumented | ✅ SELF_HOSTING note added |
| F5 | info | shape-vs-existence timing delta — not an oracle | no action (auditor conclusion) |

Post-fix gate: typecheck clean, **203 passed + 16 CI-gated skipped × 2 runs**.

### Wave 6 — Phase 5 (session engine)

| # | Subtask | Owner | Status |
|---|---|---|---|
| 6.1 | Pure draw/variant engine (seeded, deterministic, compile-time answer-stripping) + clock math | Agent SESSION | ✅ done |
| 6.2 | Session lifecycle: start/draw (single decrypt site), re-entry view, answer upserts, signals, submit | Agent SESSION | ✅ done |
| 6.3 | 53 tests (23 pure + 30 route, real crypto round-trip) | Agent SESSION | ✅ done |
| 6.I | Integration gate: decryptSecret confined to 4 sanctioned files, typecheck, **256+16 × 2** | Main | ✅ done |
| 6.Q | QA agent wave: audit Phase 5 | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 6.F | Post-QA fixes | Main | ✅ done |

**QA verdict (6.Q): PASS-WITH-FINDINGS** — no answer-leak, no clock violation,
no determinism failure; cross-process draw determinism and modulo-bias probes
executed by the auditor.

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | medium | v1 variants reorder options only — PLAN §5.2 mechanism 2's "different concrete tasks" claim not yet true; text-sharing on chance-overlap items persists | ✅ honesty fixed: PLAN §5.2 + TESTING.md T8 carry a status note (do not advertise mechanism 2 in full before data variants land with the sandbox phase) |
| F2 | low | start not atomic (crash ⇒ stranded STARTED/zero questions); empty-decrypt pool started a session instead of failing | ✅ fixed: questions+status flip in one transaction; zero items ⇒ 500 POOL_CORRUPT |
| F3 | low | stale "decrypted ONLY by the worker" comments (schema, item.ts, PLAN §5.1) | ✅ comments updated to the sanctioned API draw site |
| F4–F8 | info | ms-level double-start deadline skew; test coverage gaps (verified correct by reading); limiter-test time headroom; non-atomic signal cap; blueprint display-vs-deadline edge | logged; coverage gaps noted for CI tier |
| F9 | info | SessionQuestion.itemId unindexed (Phase 8 void-by-item needs it) | ✅ fixed: `@@index([itemId])` |

Post-fix gate: typecheck clean, **256 passed + 16 CI-gated skipped × 2 runs**.

### Wave 7 — Phase 7 (sandbox executor)

| # | Subtask | Owner | Status |
|---|---|---|---|
| 7.1 | Pure hardened argv builder + invariant checker + judge (79 tests) | Agent SANDBOX | ✅ done |
| 7.2 | DockerExecutor (spawn-only) + FakeExecutor + ExecutionResult model | Agent SANDBOX | ✅ done |
| 7.I | Integration gate: live probe — all 3 languages build HARDENED argv (assertHardenedArgs passes; no --privileged/volumes), typecheck, **335+16 × 2** | Main | ✅ done |
| 7.Q | QA agent wave: audit Phase 7 | QA agent | ✅ done — PASS-WITH-FINDINGS |
| 7.F | Post-QA fixes | Main | ✅ done |

**QA verdict (7.Q): PASS-WITH-FINDINGS** — candidate-reachable surface verified
CLOSED (probes at docker/interpreter/checker layers + docker CLI source). The
backstop checker itself had holes, verified against docker's last-occurrence-
wins semantics:

| # | Severity | Finding | Disposition |
|---|---|---|---|
| F1 | medium | `assertHardenedArgs` accepted `--network none --network host`, `--rm=false`, root-user overrides | ✅ fixed by redesign: DEFAULT-DENY EXACT-PREFIX (canonical hardened argv per language; duplicates/`=false`/extra flags all mismatch by construction) |
| F2 | medium | foreign image before the allow-listed one accepted (docker runs first positional) | ✅ fixed by same exact-prefix redesign |
| F3 | low | flag region was a deny-list of 3 (`--pid host`, `--cap-add`, … accepted) | ✅ fixed by same redesign |
| F4 | medium | case arg of literally `--privileged` aborted the whole execute() (fail-closed collateral vs own docs) | ✅ fixed: post-image tokens are never scanned — inert program data; 8 adversarial regression tests added |
| F5 | info | `__proto__` language key + non-finite timeout nits | ✅ fixed (hasOwnProperty guard, finite check) |

Post-fix gate: typecheck clean, **343 passed + 16 CI-gated skipped × 2 runs**.

**Notes:** v1 stdin-case limitation (SANDBOX_V1_NO_STDIN, failed-with-note);
mount check region-scoped so candidate argv can't false-trip containment;
live container verification (network-kill, uid, runaway-kill) deferred to
Phase 10 — daemon unavailable on this dev box, stated in code.

**Notes:** clock gradient — no grace on answers/view (closes item farming),
60s grace on submit only; draw reproducible from DB alone (seed =
session.id:pool.id); fail-closed POOL_INACTIVE during reseal. Web/mobile UI
consumption of this contract lands with Phase 6.

**Wave 5 integration notes (orchestrator):** Agent APPLY's best deviation —
skipping the zod param schema for the token route because a 400-on-bad-shape
would create exactly the validity-oracle the spec forbids (uniform 404 wins).

**Wave 4 integration notes (orchestrator):** Pool secrecy verified structurally —
`decryptSecret` is referenced only by crypto.ts, the LLM provider loader, and
the admin last-4 redactor; the blueprint module (routes + service) never
imports it. Sealing uses `encryptSecret` exactly once (line 524). Agent POOL's
blocker protocol worked as designed (halted on the missing queue.ts
pre-edit, resumed after it landed). Server-minted item ids (never
model-controlled); reseal deactivates old pools first (fail-closed during
regeneration); LLM loop bounded by call budget `ceil(need/10)×2+2`.

**Wave 3 integration notes (orchestrator):** Agent JD mounted `/intake` before
the parameterized `/:jobId` routes and justified all five spec deviations in
its report (notably: `JD_FAILED` enum reserved-but-unwritten by design —
retries re-enter the handler; failure state lives on the queue row).
Orchestrator SSRF review: guard leans on WHATWG URL canonicalization
(decimal/hex IPv4 host tricks become dotted quads before the check), handles
IPv6 compression/embedded-v4/zone-indices, re-checks post-redirect URL.
Two exotic residual vectors flagged for QA: NAT64 `64:ff9b::/96` and 6to4
`2002::/16` embeddings (require relay infrastructure to exploit).

**Wave 2 integration notes (orchestrator):** Agent LLM caught a path bug in
the spec itself (`/api/admin` mount + literal `/` route would have produced
`/api/admin/`), fixed it, and documented it. `prisma generate` on this Windows
machine hits a harmless EPERM renaming the query-engine DLL (resident node
process holds the lock; same-version engine, client verified functional —
`llmProvider` delegate present, typecheck green). Linux CI is unaffected.

## 5. Decision log

Authoritative list: [`docs/PLAN.md` §12](docs/PLAN.md#12-decision-log-founder-confirmed-2026-08-28)
(D1–D17, all locked). New decisions get appended there first, then referenced here.

## 6. Changelog

Append-only. Newest first.

- **2026-08-31 (V2-5 CLOSED — v2 complete: docs reconciled to the platform
  model)** — Every doc now tells the SaaS-multi-tenant story truthfully,
  verified against code: **BIBLE.md** (D18–D21 in the decision list; §2
  architecture + platform layer; §3 module map +`modules/platform/`,
  admin auth-config/sandbox-templates, `lib/sandbox/templates.ts`, web
  platform/admin pages; §4 platform bootstrap flow; §5 diagrams — 5.1 starts
  with super-admin wizard + company creation, 5.4 dual-mode now data-driven,
  NEW 5.5 multi-issuer resolution; §6 +multi-issuer safety argument, template
  hardening, docker-socket note; §7 ops; §8 499 suite; §9 v2 wave history;
  Last verified 2026-08-31). **API.md** (+`/api/platform/*` companies CRUD /
  settings / auth-configs / sandbox-templates; +admin auth-config &
  sandbox-templates; `GET /api/auth/mode` now `{mode, perCompany}`; register
  = super admin, no `companyName`; setup/install likewise). **RBAC.md**
  rewritten: SUPER_ADMIN local-only + lockout carve-outs, per-company
  Keycloak via PORTAL, multi-issuer resolution, `SSO_MODE_ACTIVE`, wizard v3
  flow — zero "restart the API" instructions (mode and issuers are data).
  **SELF_HOSTING.md** rewritten as the multi-tenant operator guide
  (super-admin first run, companies, per-tenant providers/keycloak/
  templates, docker-socket security note, `.env`-not-auto-loaded truth,
  compose incl. worker migrate-on-boot). **DATA_MODEL.md** (+PlatformSettings,
  CompanyAuthConfig, SandboxTemplate; User.companyId nullable;
  LlmProvider.companyId; migration-managed index table: 0001 single-active →
  0003 per-company swap, 0004 enabled-issuer, singleton dropped in 0002;
  24 models, migrations 0001–0005). **PLAN.md** §12.1 V2-1..V2-5 ✅ with
  dates; D6/D10 one-line supersession notes. **README.md** banner (SaaS
  platform, v2 complete), structure tree (+platform module), roadmap
  checkmarks. TESTING.md T3 tenancy note refreshed (between companies, not
  installs). Gate: `tsc --noEmit` clean + **483 passed + 16 skipped = 499**
  (untouched-proof, run once during the sweep). *v2 code waves recap (commits
  carry the detail): V2-1 multi-tenant core (2026-08-29, integration tier
  live 16/16 on first real run); V2-2 company-scoped LLM providers
  (2026-08-29, +worker/migrate race +docker-socket E2E catches); V2-3
  runtime per-company Keycloak (2026-08-31, multi-issuer + carve-outs
  live-proven, 431+16); V2-4 sandbox templates (2026-08-31, parameterized
  exact-prefix, 483+16).* *(main + Agent SCRIBE)*
- **2026-08-29 (E2E LIVE VERIFICATION — full loop proven)** — Real run on
  this machine: Docker engine + compose Postgres + **first-ever execution of
  migration 0001** (all singleton indexes applied and verified via \di) +
  mock OpenAI-compatible LLM (provider layer D9 proven: create → activate →
  smoke-test → used for JD/pool/eval). Full flow verified LIVE: wizard →
  login → provider → intake → JD_REVIEW → approve → blueprint → pool sealed
  (14 items, ×6 math exact, 0 invalid) → publish → apply → one-time token →
  consent meta → session start (2 questions: MCQ + CODE/BASH) → answers →
  signal → submit `{submitted:true}` → re-entry alreadyUsed (asymmetry) →
  worker EVALUATION DONE → **X-ray: MCQ DETERMINISTIC 1.0, CODE SANDBOX_LLM
  1.0 with real container execution (bash:5.2, exit 0, both hidden cases
  passed)**, assessment totalScore 1.0, TAB_SWITCH flagged, advisory-only
  recommendation. **E2E FINDINGS (2, both real): (1) `bash:5.2-alpine` did
  not exist on Docker Hub — every BASH sandbox run would have failed in
  production; FIXED to `bash:5.2` (verified by live pull; tests updated).
  (2) The documented `.env` flow is broken — nothing loads .env (no
  dotenv; compose works via explicit env). Backlog: switch dev scripts to
  `--env-file` or document inline env.** Also observed: fail-closed pool
  sealing behaved exactly as designed against a misbehaving (mock) provider
  — shortfall message, bounded retries, clean FAILED rows.
  *(main, live-run)*
- **2026-08-29 (ALL PHASES COMPLETE — wave 9b mobile)** — Expo candidate app
  landed: PanResponder swipe deck (LIKE/DISLIKE flings + tap-toggle fallback +
  replay chips), full session flow with clock/auto-submit/grace handling,
  AppState-based signal parity (APP_BACKGROUND ≙ TAB_SWITCH, flush-on-
  background), LARGE_PASTE approximation via no-keystroke insertion. Gates:
  mobile tsc ×2 zero errors; API suite untouched (386+16). **PLAN §11 phases
  0-10 all complete.** Post-MVP backlog remains tracked in §7. *(main + Agent
  MOBILE)*
- **2026-08-29 (wave 10 / Phases 9-10 CLOSED — the closer)** — AI pipeline
  stages (rules-level; enum migration deliberately next), **first committed
  migration** (523-line init + 3 singleton indexes — the agent corrected the
  pool index to per-jobId, the literal global form would break multi-job
  installs), DATA_MODEL fully rewritten (banner debt paid), README final
  state, the owed CODE-format evaluation test (FakeExecutor via doMock —
  covers SANDBOX degradation, no docker needed). Installers/compose verified
  to take the migrate-deploy branch. Gate: typecheck clean, **386 + 16
  CI-gated × 2**. Remaining: wave 9b mobile, then completion audit.
  *(main + Agent FINAL)*
- **2026-08-29 (wave 9a / Phase 6 WEB integrated)** — React portal landed
  (~4.3k LOC): candidate loop (board → apply → one-time link UX with copy +
  unrecoverable warning → consent → Swipe-MCQ/MCQ/WRITTEN/CODE test UI with
  debounced autosave, review pass, red-pulse countdown with auto-submit in
  the grace window, batched TAB_SWITCH/LARGE_PASTE/COPY signals →
  "Submitted ✓" asymmetry) + HR console (dashboard, intake wizard through
  seal+publish, pipeline, X-ray with verdicts/AI flags/execution results).
  Gates: web typecheck+build ×2 green (agent) + orchestrator re-run; API
  suite untouched (375+16). Agent corrected the spec to router truth
  (/api/stats). *(main + Agent WEB)*
- **2026-08-29 (wave 8 CLOSED — QA + fixes)** — QA verdict PASS-WITH-FINDINGS;
  both crown jewels verified clean (test-spy: zero application-status writes;
  route trace: no truth data candidate-reachable). Fixed: **evaluation wired
  to submit** (the pipeline was dormant — enqueue now fires on submitSession,
  failure never fails the submit), per-question void re-check (concurrent
  void can no longer resurrect a score), void now refreshes the FULL rollup
  over survivors + is company-scoped. Logged for later: VoidedItem FK with
  the first migration; one-sided collusion snapshot accepted v1; CODE-format
  evaluation test owed to the test sweep. Gate: typecheck clean, **375 + 16
  CI-gated × 2**. Checkpoint commit follows. Wave 9 (web portal) dispatched.
  *(main + QA agent)*
- **2026-08-29 (reboot recovery + checkpointing)** — Laptop reboot interrupted
  the wave-8 gate; disk state intact, gate re-run green (375+16 ×2).
  Checkpointing installed per user directive: repo is now a git repository —
  `checkpoint: waves 0-8` committed (143 files, tool-state excluded), wave
  boundaries become commits; RESUME-HERE block added atop this file. Stale
  "only decryption site" comment corrected (evaluation is the second,
  worker-side site). *(main)*
- **2026-08-29 (wave 8 / Phase 8 integrated)** — Evaluation pipeline landed:
  deterministic SWIPE/MCQ scoring (pure), sandbox+LLM for CODE, LLM-judged
  WRITTEN with AI-likelihood flags (never rejections — invariant verified:
  zero application-status writes), exact-match collusion flags, session
  assessment rollups, HR X-ray endpoint, void-with-renormalization (voided
  rows never resurrect on re-run). Fairness deviation: WRITTEN without a
  provider scores NOTHING rather than an unfair zero. Gate: typecheck clean,
  **375 + 16 CI-gated × 2** (+32). QA dispatched. *(main + Agent EVAL)*
- **2026-08-29 (wave 7 CLOSED — QA + redesign)** — QA verdict
  PASS-WITH-FINDINGS; candidate surface closed, but the runtime backstop
  checker missed docker's last-occurrence-wins semantics (verified against
  docker CLI source). Redesigned to DEFAULT-DENY EXACT-PREFIX matching —
  strictly stronger and simpler; `--privileged` case-arg abort fixed; 8
  adversarial tests added. Gate: typecheck clean, **343 + 16 × 2**. Wave 8
  (Phase 8: evaluation + X-ray + void) dispatched. *(main + QA agent)*
- **2026-08-29 (wave 7 / Phase 7 integrated)** — Sandbox executor landed: pure
  hardened argv builder with runtime invariant checks (defense in depth),
  spawn-only Docker adapter (no shell strings, code via stdin, region-scoped
  mount containment), pure case judging, FakeExecutor, ExecutionResult
  model; 79 tests. Orchestrator live probe: all three languages HARDENED.
  Gate: typecheck clean, **335 + 16 CI-gated × 2**. QA dispatched (7.Q).
  *(main + Agent SANDBOX)*
- **2026-08-29 (wave 6 CLOSED — QA + fixes)** — QA verdict PASS-WITH-FINDINGS
  (clean on leaks/clock/determinism; auditor executed cross-process draw
  digests and modulo-bias probes). Fixed: atomic session start (questions +
  status flip in one transaction; empty-decrypt pool ⇒ POOL_CORRUPT),
  itemId index for Phase 8, stale worker-only-decryption comments, and — most
  importantly — the PLAN §5.2 honesty note: v1 variants are order-only; the
  "different concrete tasks" claim waits for data variants. Gate: typecheck
  clean, **256 + 16 CI-gated × 2**. Next: Phase 6 (Expo mobile + web UI) or
  Phase 7 (sandbox executor) dispatch. *(main + QA agent)*
- **2026-08-29 (wave 6 / Phase 5 integrated)** — Session engine landed:
  deterministic seeded draw + variant realization with compile-time
  answer-stripping, the single sanctioned pool-decryption site, re-entry
  views that restore saved answers, format-validated answer upserts, capped
  signal ingestion, submit returning exactly `{submitted:true}`, and a
  never-pausing clock with a strict gradient (no post-deadline item access;
  60s submit grace only). Gate: typecheck clean, decryptSecret confined to
  4 sanctioned files, **256 passed + 16 CI-gated skipped × 2** (+53). QA
  agent dispatched (6.Q). *(main + Agent SESSION)*
- **2026-08-29 (wave 5 CLOSED — QA + fixes)** — QA verdict PASS-WITH-FINDINGS;
  token core verified by execution. Fixed: morgan no longer logs test-token
  URLs (the "exactly once" contract restored at the logging layer, ahead of
  Phase 5 turning tokens into session credentials), P2002 race surfaces the
  friendly 409, mint path gained 4 tests incl. hash-only storage and
  409-before-mint, SELF_HOSTING proxy note. Gate: typecheck clean, **203
  passed + 16 CI-gated skipped × 2**. Wave 6 (Phase 5: session engine —
  start/draw/variants, answers, review pass, signals, submit) dispatched.
  *(main + QA agent)*
- **2026-08-29 (wave 5 / Phase 4 integrated)** — Candidate gateway landed:
  applications against the AI-native flow mint one-time test links (32 random
  bytes, sha256-hashed at rest, plain token returned exactly once, DB-level
  single-mint backstop, 409 before any mint), consent-screen meta endpoint
  with uniform-404 probe resistance, per-IP rate limits (apply and token
  probes in independent buckets), board `testRequired` flags via
  existence-only pool probes. Gate: typecheck clean, **199 passed + 16
  CI-gated skipped × 2** (+21). QA agent dispatched (5.Q). *(main + Agent
  APPLY)*
- **2026-08-29 (wave 4 CLOSED — QA + fixes)** — QA verdict PASS-WITH-FINDINGS;
  pool invisibility survived adversarial audit. All findings fixed: DB-backed
  leakage matrix (canary method) + CI postgres tier (first run in CI —
  flagged), unique option ids, hiddenCase ≥1 expectation, scalar-only pool
  reads, stale-sample cleanup, JD delimiter neutralization. Gate: typecheck
  clean, 178 pass + 16 CI-gated skip × 2. Wave 5 (Phase 4: public board,
  apply, one-time test links) dispatched. *(main + QA agent)*
- **2026-08-29 (wave 4 / Phase 3 integrated)** — The "bulletproof" core
  landed: blueprint (sections/time — zero questions), sample preview items
  (HR-visible, never drawable), and the sealed question pool — worker-
  generated per blueprint with the ×6 pool-size rule as pure tested math,
  encrypted with the AES-256-GCM box, under-generation retry then hard
  refusal, server-minted item ids, re-seal that fails closed. Pool secrecy
  verified structurally by the orchestrator (decryptSecret unreachable from
  the blueprint module). Gate: typecheck clean, **174/174 × 3 runs** (+50
  tests). QA agent dispatched (4.Q). *(main + Agent POOL)*
- **2026-08-29 (wave 3 CLOSED — QA + fixes)** — QA verdict
  PASS-WITH-FINDINGS with live-verified exploits: `[::]` SSRF bypass (fixed +
  re-verified), screenshot caps dead-lettering on the 1mb body limit (fixed
  with route-scoped parser + honest 413), NAT64/6to4/Teredo rejects,
  redirect status-oracle closed, queue crash-loop and orphan-draft fixes,
  maxTokens truncation fix, SSRF test vectors added. Gate: typecheck clean,
  **124/124 × 3 runs**. Wave 4 (Phase 3: blueprint editor + sealed pool +
  sample preview) dispatched. *(main + QA agent)*
- **2026-08-29 (wave 3 / Phase 2 integrated)** — Role-intake subsystem
  landed: DB-backed job queue (atomic conditional-update claims, exponential
  backoff, stale-run recovery), worker entrypoint (`dev:worker` /
  `start:worker` — same image, second CMD), SSRF-guarded page fetching
  (WHATWG canonicalization + literal private-range checks + post-redirect
  re-check), JD generation through the provider seam with strict-JSON
  tolerance, and the HR edit/approve loop gated on JD_REVIEW. Intake refuses
  to create anything without an active provider (no orphan drafts).
  Orchestrator gate: typecheck clean, **121/121 × 3 runs**; NAT64/6to4
  residual vectors flagged for QA. QA agent dispatched (3.Q). *(main + Agent
  JD)*
- **2026-08-29 (wave 2 CLOSED — QA + fixes)** — QA verdict
  PASS-WITH-FINDINGS. Both majors fixed: flaky crypto tamper test (the
  orchestrator's 91/91 was luck — now deterministic, verified 10×+5×), and a
  production boot guard refusing the public SECRETS_KEY default
  (live-verified). Minors: provider statuses collapsed to 502, deterministic
  oldest-first active-provider read, race documented in schema. Gate:
  typecheck clean, **94/94 × 5 runs**. Wave 3 (Phase 2: DB-backed job queue +
  worker entrypoint + role intake → JD generation) dispatched. *(main + QA
  agent)*
- **2026-08-29 (wave 2 / Phase 1 integrated)** — LLM provider subsystem
  landed: AES-256-GCM secret box (versioned envelope, per-call key
  derivation, uniform decrypt failure), adapter layer (OpenAI-compatible /
  Anthropic / Azure OpenAI; 60s timeout, single retry on 429/5xx,
  secret-scrubbed errors), admin CRUD + transactional single-active
  activation + live smoke test, keys never returned (last-4 only),
  `docs/SELF_HOSTING.md`. Orchestrator gate: typecheck clean, **91/91
  tests** (+32), security spot-review of crypto/redaction/activation clean.
  QA agent dispatched (2.Q). *(main + Agent LLM)*
- **2026-08-29 (wave 1 CLOSED — QA + fixes)** — QA audit verdict
  PASS-WITH-FINDINGS; all actionable findings fixed (major: unauthenticated
  `/api/auth/register` bypassed the wizard's single-company lock — now 409s;
  JWKS amplification floored at 30s + cached discovery; issuer trailing-slash
  normalized at env parse; setup module gained its missing test file).
  Gate after fixes: typecheck clean, **59/59 tests**. Wave 2 (Phase 1: LLM
  provider abstraction — schema, AES-256-GCM secret crypto, three adapters,
  admin CRUD + smoke test) dispatched. *(main + QA agent)*
- **2026-08-29 (wave 1 integrated)** — Both subsystems landed and passed the
  orchestrator gate: typecheck clean (api + shared), **53/53 tests** (35
  existing + 18 OIDC), live smoke test of the wizard and auth guard. RBAC:
  dual-mode `requireAuth` (local dev JWT vs Keycloak OIDC RS256 + JWKS cache,
  zero new deps), role mapping, realm export with audience mapper (without it
  real Keycloak tokens would fail `aud` verification — agent's own catch),
  `docs/RBAC.md` with the Azure AD brokering runbook. SETUP: `install.sh`
  (with `db push` fallback while no migrations are committed) + `install.cmd`,
  self-locking `/setup` wizard (helmet-CSP-safe same-origin JS, rate-limited,
  reuses `register()`), root `docker-compose.yml` (db + Keycloak + API with
  migrate-on-boot), monorepo-correct multi-stage Dockerfile (explicit COPY
  paths because root context ignores app-level .dockerignore), CI workflow.
  Agent SETUP's report arrived late (task-handle race, not a failure);
  artifacts were verified manually in the interim. QA agent dispatched (1w.Q).
  *(main + agents RBAC/SETUP)*
- **2026-08-29 (wave 1 dispatched)** — Founder directives landed as D15
  (Keycloak OIDC RBAC with Azure AD federation; local dev-mode retained),
  D16 (install CLI + self-locking web wizard + compose stack), D17 (serial
  integration through orchestrator + QA agent waves). Agents RBAC and SETUP
  dispatched in parallel under the ownership matrix in §4. Phase 1 (LLM
  providers) queued for wave 2 due to schema/package.json contention. *(main)*
- **2026-08-29 (Phase 0 closed)** — Agent A restructured to monorepo
  (`apps/api`, placeholder `apps/{web,worker,mobile}`, `packages/shared`,
  root workspaces). Agent B switched to Apache-2.0 (LICENSE + NOTICE),
  rebranded README/CONTRIBUTING/SECURITY. Main-agent verification pass caught
  and fixed **3 real defects**: (1) missing `User.stageEvents` back-relation in
  Prisma schema (P1012 — client generation silently stubbed), (2) JWT
  `expiresIn` typing, (3) body-parser errors returning 500 instead of 400.
  Gates green: root `npm install` (workspaces validated), `prisma generate`,
  typecheck api + shared, **35/35 tests**. Also set `apps/api` license to
  Apache-2.0 (agent A had left MIT per spec). *(main + agents A/B)*
- **2026-08-29** — Working system established: this tracker, test strategy
  (`docs/TESTING.md`), docs system (`docs/DOCUMENTATION.md`). Phase 0 launched
  with two parallel worker agents (A: restructure, B: license/rebrand) under
  disjoint file ownership. *(main)*
- **2026-08-28** — PLAN v4 locked: name **ProvaHR**; mobile-native (Expo);
  **Swipe MCQ** format (per-option like/dislike, review-pass replay);
  "bulletproof" sealed question pool (D12). Tracking-spine API written earlier
  in `server/` (auth, jobs, pipeline, interviews, scorecards, tests). *(main)*

## 7. Risks & watch items

| Risk | Mitigation / status |
|---|---|
| "ProvaHR" adjacent collisions (a Utah "Prova" assessment startup, "Prova AI" in education) | Formal domain + trademark clearance before any public launch (PLAN §14) |
| ~~`npm install` never completed on this machine~~ | ✅ Resolved 2026-08-29: root install succeeded, workspaces linked, 35/35 tests green |
| Prisma warns `package.json#prisma` config is deprecated (removal in Prisma 7) | Cosmetic for now; migrate to `prisma.config.ts` during Phase 1 worker setup |
| Windows/Git Bash dev environment | Keep all scripts POSIX-portable; CI (ubuntu) is the source of truth |
| `docs/DATA_MODEL.md` describes the pre-v4 schema | Marked stale with a banner; full rewrite due when Phase 2–3 entities land |
| Untrusted code execution (Phase 7 sandbox) | Hardening spec in PLAN §10; CI lint planned: no `--privileged`, no host network |
| Keycloak adds operational weight for small self-hosters | Dev-mode (local password JWT) is the default (`OIDC_ENABLED=false`); Keycloak is opt-in per install |
| Setup wizard is a first-run attack surface if left unlocked | Wizard hard-locks once a company exists; status-only afterwards; POST rate-limited; spec'd in 1b.2 |

## 8. Maintaining this file

- Update §2/§3 tables **as work starts and lands** (not from memory at the end).
- Append a changelog line for every landed subtask with the owning agent noted.
- If a risk materializes or dissolves, update §6 in the same session.

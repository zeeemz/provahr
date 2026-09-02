# ProvaHR — Test Strategy

> Comprehensive, phase-aligned test plan. Tests ship **with** the phase that
> introduces the code — a module without tests does not merge (Definition of
> Done in [`PROGRESS.md`](../PROGRESS.md) §1).
>
> Status: **v1 (process ratified 2026-08-29)** · Owner: main harness agent ·
> Every worker agent must read this before writing code in `apps/*`.

---

## 1. Principles

1. **Deterministic by default.** No live LLM calls, no network, no wall-clock
   dependence in unit/integration tiers. LLM behavior is tested against
   **recorded fixtures** and mocked HTTP.
2. **The critical paths get real tests, everything else gets coverage.**
   §6 lists the paths that must never regress; coverage percentages are a
   floor, not the goal.
3. **Security properties are tests, not reviews.** Sealed-pool invisibility,
   tenancy isolation, one-time tokens, and flag-never-auto-reject are asserted
   by automated tests (tier 3), not by hoping.
4. **Signal parity is contractual.** Web and mobile sessions must produce
   comparable proctoring evidence — asserted via the shared contracts in
   `@provahr/shared`.

## 2. Test pyramid (tiers)

| Tier | Scope | Runs on | Tech |
|---|---|---|---|
| T1 Unit | Pure domain logic: stage/status rules, draw & variant math, Swipe-MCQ scoring, time budgets, token crypto, blueprint validation, void/re-normalization math | every PR | Vitest (exists: `apps/api/tests/*`) |
| T2 Integration | Prisma repositories + services against real PostgreSQL; session lifecycle state machine; sealed-pool encrypt/decrypt round-trip | every PR (CI service container; locally via Docker) | Vitest + testcontainers-style setup |
| T3 Contract & security | Full route matrix over HTTP: role access (SUPER_ADMIN/ADMIN/RECRUITER/INTERVIEWER/anonymous), sealed-pool leakage (**no endpoint returns future-session items**), one-time token single-use + expiry, rate limits, tenancy isolation **between companies on one install** (cross-tenant reads 404; super admin never reaches company routes) | every PR | supertest (exists) + DB |
| T4 Sandbox executor | Container hardening: network disabled (a `curl`-ing program must fail), non-root UID asserted, CPU/mem/wall-clock limits kill runaway code, output truncation, hidden test-case harness, per-language image matrix (bash/node/python) | PRs touching sandbox; scheduled otherwise | Docker required |
| T5 LLM adapters | OpenAI-compatible / Anthropic / Azure adapters: auth headers, base URLs, error mapping, retries, JSON-mode parsing, image inputs — against mocked endpoints; prompt templates snapshot-tested | every PR | undici/nock-style mocks + fixture tapes |
| T6 Evaluation logic | Grading against fixture LLM responses; AI-likelihood combination rules (signals × style); cross-session collusion detector on crafted answer sets; asymmetry rule (candidate never sees evaluations — API-level assertion) | every PR | Vitest fixtures |
| T7 E2E | Web candidate loop (board → apply → consent → Swipe-MCQ session → review pass → submit) and HR loop (intake → blueprint → X-ray → pipeline) on a seeded install; mobile E2E from Phase 6 | `main` + nightly | Playwright (web); Maestro or Detox (mobile) |
| T8 Property-based | Seeded-nonce determinism (same seed ⇒ same draw+variants), variant divergence (same item, two sessions ⇒ different surface data; v1 = option-order divergence only — data variants land with the sandbox phase, PLAN §5.2 status note), scoring monotonicity (better valuations ⇒ score never decreases) | every PR | fast-check |

## 3. What each phase must add (the contract)

| Phase | Required tests landing with it |
|---|---|
| 0 | Existing T1/T3 suite still green after restructure; root `npm test` wires workspaces |
| 1 | T5 adapter suite (3 providers) + T2 provider-config CRUD + T3 keys-never-returned assertion + connectivity smoke test (mocked + real-if-env) |
| 2 | T5 JD-generation prompt snapshots; T2 intake job lifecycle; URL-fetch safety (SSRF guard: private IP ranges refused) |
| 3 | T1 blueprint validation, draw math (≥6× pool, no repeats), variant realization; T2 seal/re-seal; **T3 leakage matrix**; T8 draw determinism |
| 4 | T3 apply flow, one-time tokens (single-use, expiry, rotation), rate limits |
| 5 | T1 Swipe-MCQ scoring incl. partial credit + revision semantics; T2 session state machine (start → answers upsert → review → submit; clock never pauses); T3 candidate-visibility asymmetry |
| 6 | T7 mobile E2E; signal-parity tests (APP_BACKGROUND ≙ TAB_SWITCH via `@provahr/shared`) |
| 7 | T4 full matrix; hidden-case harness; execution result fidelity |
| 8 | T6 evaluation suite; void/re-normalization math (T1); collusion detector (T6) |
| 9 | T3 pipeline stage extensions; dashboard stats correctness |
| 10 | Load smoke on session endpoints; retention/erasure cascade tests |

## 4. Test data & fixtures

- **Factories over fixtures** for entities; deterministic RNG via explicit seeds.
- LLM interactions recorded as **fixture tapes** (`tests/fixtures/llm/…`) with
  a `record:env-var` mode for refreshing; never committed with real API keys.
- The seed script (`apps/api/prisma/seed.ts`) doubles as the E2E demo dataset.

## 5. CI layout (GitHub Actions)

```
jobs:                       # CURRENT reality (.github/workflows/ci.yml)
  api:        npm ci → prisma generate → db push → typecheck → T1–T3
              (+ the INTEGRATION_DB=1 leakage matrix against a postgres service)
  shared:     npm ci → typecheck
```

Planned tiers not yet in CI (tracked in PROGRESS): `worker` (with Docker for
T4), `web` (typecheck + build), `mobile` (typecheck), and a seeded-stack
`e2e` Playwright job. Until they land, the web/mobile `tsc` gates and the
sandbox T4 suite run locally per wave.

No secrets required for green CI. Real-provider smoke tests run only when
`LLM_SMOKE_KEY` secret is present (otherwise skipped, visibly).

## 6. Never-regress list (critical paths)

1. **Flag, never auto-reject** — no route/job can set REJECTED from an AI
   verdict; rejections require a human actor + reason (T3/T6 assert this).
2. **Sealed-pool invisibility** — exhaustive route matrix returns no
   future-session items for any role, including ADMIN (T3).
3. **One-time test tokens** — second use of a token fails; expiry enforced (T3).
4. **Tenancy isolation** — cross-company data access 404s on the same install (T3; v2: tenants, not installs).
5. **Session clock** — review pass and revising answers never pause the clock (T2).
6. **Candidate asymmetry** — no public endpoint exposes evaluations (T3).
7. **Sandbox containment** — network egress fails inside the executor (T4).

## 7. Review rules

- Bug fixes ship with the test that would have caught them.
- Coverage floors: `packages/shared` and rules modules ≥ 90% lines; services ≥
  80%; anything lower needs a comment in the PR explaining why.
- Flaky tests are quarantined within 24h (skipped with an issue link) — never
  left red or silently deleted.

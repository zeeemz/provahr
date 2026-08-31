# ProvaHR

**The AI-native, open-source hiring platform — now a multi-tenant SaaS. AI works for HR — candidates prove their skill.**

> ✅ **v2 complete** — the full candidate/HR loop runs (API + worker + web
> portal + Expo mobile app, E2E-proven including a real sandboxed code
> execution), and the install is now a **platform**: a super admin owns it,
> companies (tenants) are created from the platform console, and each company
> brings its own LLM keys, its own Keycloak realm and its own sandbox images
> (decisions D18–D21). Remaining work is the tracked post-v2 backlog. Start
> with [docs/BIBLE.md](docs/BIBLE.md) — the map of record — and the
> [plan of record](docs/PLAN.md).

## What makes it different

- **AI-native loop** — describe a person (paste a LinkedIn screenshot or URL) and get
  back a job description, a sealed skills test, and LLM-evaluated results. HR edits and
  approves every step; AI never decides.
- **Proof over polish** — candidates take real, sandbox-executed tests. Code
  tasks run in hardened, per-run containers with hidden test cases — not take-home
  essays anyone can delegate.
- **Bulletproof question integrity** — HR designs the blueprint (skills, difficulty,
  count); nobody, not even HR, can enumerate the questions. The pool is sealed
  (encrypted, no API exposure), and every session gets a random draw with per-session
  variants, so sharing answers is useless.
- **Multi-tenant platform** — one self-hosted install hosts many companies
  (Apache-2.0). Each tenant brings its own LLM keys (OpenAI-compatible,
  Anthropic, or its own Azure OpenAI tenant), its own Keycloak realm for SSO,
  and even its own sandbox images. Hiring data never leaves your
  infrastructure, and tenants cannot see each other's.

> **Fairness, built in.** AI flags suspicion but **never auto-rejects** — humans make
> every decision. Proctoring scope is disclosed before every test. No webcam or screen
> recording, ever. See [docs/PLAN.md §10](docs/PLAN.md).

## Repository structure

```
├── apps/
│   ├── api/         # REST API + worker loop (Express + Prisma) — implemented
│   │   ├── src/modules/platform/   # super-admin console: tenants, runtime settings
│   │   ├── src/modules/admin/      # per-company: llm-providers, auth-config,
│   │   │                           #   sandbox-templates
│   │   └── src/worker.ts   # background jobs: JD generation, pool seal, evaluation
│   ├── web/         # React portal (Vite) — platform console + HR console +
│   │                #   candidate test UI, implemented
│   ├── worker/      # placeholder — the worker ships inside apps/api today
│   └── mobile/      # Expo candidate app (shipped: swipe deck, signal parity)
├── packages/
│   └── shared/      # cross-app TypeScript contracts
├── docs/            # BIBLE.md (start here) + plan, API, data model, testing,
│                    #   self-hosting, RBAC, documentation guides
├── scripts/         # install.sh / install.cmd
├── docker-compose.yml   # db + Keycloak + API + worker (both migrate-on-boot)
├── LICENSE          # Apache-2.0
└── NOTICE.md
```

## Quickstart (local dev)

Prerequisites: **Node.js ≥ 20**, **PostgreSQL 16** (Docker recommended).

```bash
git clone https://github.com/YOUR_ORG/provahr.git
cd provahr

# 1. Start Postgres 16 (compose also offers Keycloak + the API itself)
docker compose up -d db

# 2. Install workspaces and prepare the database
npm install                          # or: bash scripts/install.sh (does 2–4 for you)
cd apps/api
cp .env.example .env                 # point DATABASE_URL at your Postgres
                                     #   (NOTE: .env is not auto-loaded — export
                                     #   the vars or run compose; see docs/SELF_HOSTING.md)
npx prisma generate
npx prisma migrate deploy            # committed migrations 0001–0005
npm run seed                         # demo company, jobs, applications

# 3. Run the API  → http://localhost:4000
npm run dev

# 4. Run the web portal (new terminal) → http://localhost:5173
cd ../web && npm run dev             # dev server proxies /api → :4000

# 5. Optional: the background worker (new terminal) — JD drafts, pool
#    sealing, evaluation. Without it, enqueued jobs simply wait.
cd ../api && npm run dev:worker
```

First boot on a fresh database: open `http://localhost:4000/setup` — the
self-locking wizard creates the **platform super admin**, then locks itself.
Sign in and create your first company (with its admin) from
**Platform → Companies**. Per-company LLM keys, Keycloak realms and sandbox
images are configured inside each tenant (Admin → Providers / Auth /
Settings); the local ⇄ SSO switch is a runtime platform setting — no restarts.

Seeded demo login (dev seed): `admin@acme.test` / `password123`.

Tests: `npm test` from the repo root (API suite: 483 unit/route tests + the
CI-gated integration tier, 16 — 499 total).

## Documentation

**Start here: [docs/BIBLE.md](docs/BIBLE.md)** — the single source of truth /
map of record (product, architecture, data flow, sequence diagrams, security
model, history, and where every kind of truth lives).

- [docs/BIBLE.md](docs/BIBLE.md) — **start here**; the map of record for the whole system
- [docs/PLAN.md](docs/PLAN.md) — product plan of record + the D1–D21 decision log
- [docs/API.md](docs/API.md) — endpoint reference (methods, roles, shapes, error codes)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — the 24 Prisma models, field by field
- [docs/TESTING.md](docs/TESTING.md) — test tiers + the never-regress list
- [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) — multi-tenant operator guide: install env,
      companies, per-tenant LLM providers / Keycloak / sandbox templates, proxy notes
- [docs/RBAC.md](docs/RBAC.md) — super admin vs company roles, local vs Keycloak
      (multi-issuer), role mapping, Azure AD brokering
- [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) — the docs system itself
- [PROGRESS.md](PROGRESS.md) — phase status, changelog, QA wave findings

## Roadmap

Details in [docs/PLAN.md §11](docs/PLAN.md) + [§12.1](docs/PLAN.md) (v2);
status tracker in [PROGRESS.md](PROGRESS.md).

- [x] **Phase 0** — monorepo, Apache-2.0, plan sign-off
- [x] **Phase 1** — LLM provider abstraction + admin CRUD + connectivity test
- [x] **Phase 2** — role intake → JD generation (screenshot + URL + LLM) with HR edit loop
- [x] **Phase 3** — blueprint editor + sample preview + sealed pool generation (+ re-seal)
- [x] **Phase 4** — public job board, apply flow, one-time test links
- [x] **Phase 5** — candidate test portal (web): consent, draw + variants, Swipe-MCQ
      and other formats, review pass, hard clock, signal capture
- [x] **Phase 7** — sandbox executor (Docker) + hidden test cases + execution results
- [x] **Phase 8** — LLM evaluation pipeline (verdicts, AI-likelihood, collusion) + HR
      X-ray + void-with-renormalization
- [x] **Phase 9 (rules)** — pipeline stage vocabulary for the AI loop
      (`Applied → Test → Review → Interview → Offer → Hired`, rules-level pending
      the Stage enum migration)
- [x] **Phase 6 / 9b** — Expo mobile app: browse, apply, consent, swipe-gesture
      sessions, signal parity (`tsc`-gated; device-run pending an emulator)
- [x] **Live sandbox verification** — E2E run executed a candidate BASH answer in a
      real hardened container (both hidden cases passed)
- [x] **V2-1** — multi-tenant core: SUPER_ADMIN, runtime platform settings,
      company CRUD, wizard v3 (super admin only)
- [x] **V2-2** — company-scoped LLM providers (per-company single-active index)
- [x] **V2-3** — runtime per-company Keycloak: multi-issuer resolution, portal
      switch, super-admin lockout carve-out
- [x] **V2-4** — company sandbox image templates (parameterized exact-prefix
      hardening)
- [x] **V2-5** — docs reconciled to the platform model
- [ ] **Post-v2 residue** — hardening backlog: CI has never run (no remote),
      automated E2E tier, shared rate-limiter store across API+worker,
      per-session **data variants** (v1 variants reorder options only),
      Stage enum migration (TEST/REVIEW), docker socket-mount isolation per
      tenant, retention jobs

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). All participants
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Follow the private disclosure process in
[SECURITY.md](SECURITY.md) — do not open a public issue.

## License

[Apache-2.0](LICENSE) © 2026 The ProvaHR Authors — see also [NOTICE.md](NOTICE.md).

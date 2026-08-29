# ProvaHR

**The AI-native, open-source hiring platform. AI works for HR — candidates prove their skill.**

> ✅ **MVP complete** — the full loop runs: API + worker + web portal **and the
> Expo mobile app** are implemented and tested; the loop was verified live
> end-to-end (including a real sandboxed code execution). Remaining work is
> the tracked post-MVP backlog. Start with [docs/BIBLE.md](docs/BIBLE.md) —
> the map of record — and the [plan of record](docs/PLAN.md).

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
- **Open & sovereign** — Apache-2.0, self-hosted, and bring your own LLM:
  OpenAI-compatible, Anthropic, or Azure OpenAI on your own tenant. Your hiring data
  never leaves your infrastructure.

> **Fairness, built in.** AI flags suspicion but **never auto-rejects** — humans make
> every decision. Proctoring scope is disclosed before every test. No webcam or screen
> recording, ever. See [docs/PLAN.md §10](docs/PLAN.md).

## Repository structure

```
├── apps/
│   ├── api/         # REST API + worker loop (Express + Prisma) — implemented
│   │   └── src/worker.ts   # background jobs: JD generation, pool seal, evaluation
│   ├── web/         # React portal (Vite) — HR console + candidate test UI, implemented
│   ├── worker/      # placeholder — the worker ships inside apps/api today
│   └── mobile/      # Expo candidate app (shipped: swipe deck, signal parity)
├── packages/
│   └── shared/      # cross-app TypeScript contracts
├── docs/            # BIBLE.md (start here) + plan, API, data model, testing,
│                    #   self-hosting, RBAC, documentation guides
├── scripts/         # install.sh / install.cmd
├── docker-compose.yml   # db + Keycloak + API (migrate-on-boot)
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
npx prisma generate
npx prisma migrate deploy            # committed migrations (0001_init incl. singleton indexes)
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
self-locking wizard creates your company and first admin, then locks itself.

Seeded demo login: `admin@acme.test` / `password123`.

Tests: `npm test` from the repo root (API suite: unit + CI-gated integration tier).

## Documentation

**Start here: [docs/BIBLE.md](docs/BIBLE.md)** — the single source of truth /
map of record (product, architecture, data flow, sequence diagrams, security
model, history, and where every kind of truth lives).

- [docs/BIBLE.md](docs/BIBLE.md) — **start here**; the map of record for the whole system
- [docs/PLAN.md](docs/PLAN.md) — product plan of record + the D1–D17 decision log
- [docs/API.md](docs/API.md) — endpoint reference (methods, roles, shapes, error codes)
- [docs/DATA_MODEL.md](docs/DATA_MODEL.md) — the 21 Prisma models, field by field
- [docs/TESTING.md](docs/TESTING.md) — test tiers + the never-regress list
- [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) — install env, LLM providers (incl. Azure tenant), proxy notes
- [docs/RBAC.md](docs/RBAC.md) — local vs Keycloak auth, role mapping, Azure AD brokering
- [docs/DOCUMENTATION.md](docs/DOCUMENTATION.md) — the docs system itself
- [PROGRESS.md](PROGRESS.md) — phase status, changelog, QA wave findings

## Roadmap

Details in [docs/PLAN.md §11](docs/PLAN.md); status tracker in
[PROGRESS.md](PROGRESS.md).

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
- [ ] **Phase 10 residue** — hardening backlog: shared rate-limiter store across
      API+worker, per-session **data variants**
      (v1 variants reorder options only), Stage enum migration (TEST/REVIEW),
      retention jobs

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). All participants
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Follow the private disclosure process in
[SECURITY.md](SECURITY.md) — do not open a public issue.

## License

[Apache-2.0](LICENSE) © 2026 The ProvaHR Authors — see also [NOTICE.md](NOTICE.md).

# ProvaHR

**The AI-native, open-source hiring platform. AI works for HR — candidates prove their skill.**

> 🚧 **Pre-alpha** — the tracking spine is implemented; AI-native features are under
> active development. See the plan of record: [docs/PLAN.md](docs/PLAN.md)

## What makes it different

- **AI-native loop** — describe a person (paste a LinkedIn screenshot or URL) and get
  back a job description, a sealed skills test, and LLM-evaluated results. HR edits and
  approves every step; AI never decides.
- **Proof over polish** — candidates take real, sandbox-executed tests. Bash and code
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
│   ├── api/         # REST API — tracking spine (implemented)
│   ├── web/         # HR console + candidate portal (planned, Phase 4+)
│   ├── worker/      # LLM + sandbox jobs (planned, Phase 1+)
│   └── mobile/      # Expo candidate app (planned, Phase 6+)
├── packages/
│   └── shared/      # cross-app TypeScript contracts
├── docs/            # plan, data model, testing, documentation guides
├── LICENSE          # Apache-2.0
└── NOTICE.md
```

Today only `apps/api` is implemented: auth, roles/JBAC, jobs, the application
pipeline, interviews, scorecards, stats, and tests. It is the tracking spine the
AI-native loop (Phases 1–10) plugs into.

## Quickstart (local dev — API only today)

Prerequisites: **Node.js ≥ 20**, **PostgreSQL 16**.

```bash
git clone https://github.com/YOUR_ORG/provahr.git
cd provahr

# Start Postgres 16
docker compose up -d db
# Note: docker-compose.yml ships in a later phase — for now run any
# Postgres 16 and set DATABASE_URL in apps/api/.env.

cd apps/api
cp .env.example .env         # point DATABASE_URL at your Postgres
npm install
npx prisma migrate deploy    # create schema
npm run seed                 # demo company, jobs, applications
npm run dev                  # → http://localhost:4000
npm test                     # test suite
```

Seeded demo login: `admin@acme.test` / `password123`.

## Roadmap

One line per phase — details in [docs/PLAN.md §11](docs/PLAN.md):

- **Phase 0** — repo restructure to monorepo, Apache-2.0 switch, plan sign-off
- **Phase 1** — LLM provider abstraction + admin CRUD + connectivity test
- **Phase 2** — role intake → JD generation (screenshot + URL + LLM) with HR edit loop
- **Phase 3** — blueprint editor + sample preview + sealed pool generation (+ re-seal)
- **Phase 4** — public job board, apply flow, one-time test links
- **Phase 5** — candidate test portal (web): consent, draw + variants, Swipe-MCQ and
  other formats, review pass, clock, signal capture
- **Phase 6** — candidate mobile app (Expo): browse, apply, consent, swipe-gesture
  sessions, signal parity
- **Phase 7** — sandbox executor (Docker) + hidden test cases + execution results
- **Phase 8** — LLM evaluation pipeline (verdicts, AI-likelihood, collusion) + HR
  X-ray + void
- **Phase 9** — pipeline integration (Test/Review stages) + dashboard + flags
- **Phase 10** — hardening: rate limits, key + pool encryption, retention, docs,
  seed, Compose deploy

Phases 1–3 are demoable standalone; 4–8 form the candidate loop; 9 ties everything
into the ATS spine.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). All participants
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? Follow the private disclosure process in
[SECURITY.md](SECURITY.md) — do not open a public issue.

## License

[Apache-2.0](LICENSE) © 2026 The ProvaHR Authors — see also [NOTICE.md](NOTICE.md).

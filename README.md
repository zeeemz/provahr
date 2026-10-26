# ProvaHR

### The open-source HackerRank alternative — hiring that runs on proof, not polish.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-578%20passing-brightgreen.svg)](PROGRESS.md)
[![Self-hosted](https://img.shields.io/badge/deployment-self--hosted-orange.svg)](docs/SELF_HOSTING.md)

**Candidates take a real skill test — questions sealed in an encrypted pool nobody can leak, code executed live in a sandboxed IDE — while AI does the grunt work for your recruiters and is never allowed to reject anyone.**

- 🔐 **A question pool nobody can enumerate.** Generated items are AES-256-encrypted at rest, 6× larger than any single test, and readable by no role in the system — not even the admin. You can't leak what you can't see.
- 🖥️ **Candidates code in a real IDE.** Monaco editor, multi-file workspace with a file explorer, a Run button that executes their code in a hardened container, instant marking on objective answers at submission.
- 🚩 **AI flags, humans decide.** When the system suspects AI assistance it raises a flag — it never auto-rejects. Every hire/no-hire has a person's name on it, on an append-only audit trail.
- 🏠 **Self-hosted, your data, your keys.** Docker Compose, Postgres, per-tenant LLM providers (OpenAI-compatible / Anthropic / Ollama). Nothing leaves your infrastructure.
- 💸 **$0 per seat.** AGPL-3.0. Bring your own everything.

> 🚀 **Watch the demo**: [`docs/assets/provehr-sales-pitch.mp4`](docs/assets/provehr-sales-pitch.mp4) — a 2-minute labeled walkthrough of the entire product.

---

## Why teams switch

| | HackerRank / Codility / CodeSignal | ProvaHR |
|---|---|---|
| License | Proprietary | **AGPL-3.0, fully open source** |
| Hosting | Their cloud | **Yours** — Docker Compose, air-gap friendly |
| Candidate data | Their servers | **Your database** |
| Question banks | Their catalog + yours, plain | **Your pool, sealed** — encrypted at rest, invisible to every role, 6× the draw size |
| Test experience | Browser IDE | **Browser IDE** — Monaco, multi-file explorer, Run-in-container, instant objective marks |
| AI policy | Their black box | **Flags, never auto-reject** — humans sign every decision, append-only audit trail |
| LLM costs | Bundled | **Bring your own keys** — per-tenant providers, any OpenAI-compatible endpoint |
| Price | Commercial, per-seat | **$0** |

## The 60-second product

| For HR | For candidates | For the platform owner |
|---|---|---|
| Describe a person (LinkedIn screenshot, URLs, notes) → AI drafts the JD | Take a real, role-specific skill test — no fluff | Onboard companies (tenants) with their own admins |
| Design a test blueprint; the platform seals a question pool **nobody can enumerate** — not even admins | Code in a **real IDE**: multi-file workspace, Run button, hidden test cases after submit | Each tenant brings its own LLM keys (OpenAI-compatible / Anthropic / Ollama) |
| See the **X-ray**: every answer, every sandbox run, the correct answer **and why**, AI-likelihood flags, signals | See **instant marking on multiple-choice answers** at submission (written/code go to human evaluation) | Per-tenant Keycloak realms, sandbox image templates, team RBAC |
| Reject with a mandatory reason — AI can **never** reject | Walk-ins tested on the spot (HR checks them in, candidate takes it on the spot) | Two-tier AI prompts: platform rules (root) + role-specific (HR) |

## Demo videos

- **[`docs/assets/provehr-sales-pitch.mp4`](docs/assets/provehr-sales-pitch.mp4)** — the full demo: 12 labeled chapters (platform setup, tenant onboarding, the AI loop, candidate experience, the X-ray, human pipeline).
- **[`docs/assets/demo-two-tier-prompts.mp4`](docs/assets/demo-two-tier-prompts.mp4)** — the two-tier system-prompt feature in detail.

## UI / UX

### The platform (super admin)

| | |
|---|---|
| ![Platform console](docs/assets/screenshots/f001.png) | ![Auth mode](docs/assets/screenshots/f006.png) |
| *Super-admin console: tenants, sandbox templates, auth mode* | *Runtime auth switch — Local ↔ Keycloak, no restart; lockout-proof* |

### The company admin (HR)

| | |
|---|---|
| ![LLM providers](docs/assets/screenshots/f009.png) | ![AI prompts](docs/assets/screenshots/f013.png) |
| *Per-tenant LLM providers — encrypted keys, one-click test* | *Two-tier prompts: platform rules (read-only) + role-specific (editable)* |

### The AI loop

| | |
|---|---|
| ![JD draft](docs/assets/screenshots/f017.png) | ![Sealed pool](docs/assets/screenshots/f020.png) |
| *AI-drafted JD with both prompt tiers applied* | *Sealed question pool — ≥6× draw, encrypted, counts only* |

### The candidate

| | |
|---|---|
| ![One-time link](docs/assets/screenshots/f018.png) | ![Standard web questionnaire](docs/assets/screenshots/f022.png) |
| *Apply → the one-time test link, shown exactly once* | *Standard web questionnaire — select-all checkboxes (swipe on mobile)* |

| | |
|---|---|
| ![Code task](docs/assets/screenshots/f023.png) | ![Submitted](docs/assets/screenshots/f026.png) |
| *Code task — now a full IDE: Monaco, multi-file, Run-in-sandbox* | *"Submitted ✓" + instant marking on the multiple-choice part* |

### The HR X-ray

| | |
|---|---|
| ![X-ray](docs/assets/screenshots/f030.png) | ![Human pipeline](docs/assets/screenshots/f033.png) |
| *Every answer, every sandbox run, correct answers **and why** — HR only* | *Humans decide — rejection always demands a reason* |

---

## Quickstart

**Prerequisites:** Docker (Docker Desktop), Node.js ≥ 20.

```bash
git clone https://github.com/zeeemz/provahr.git provahr && cd provahr
docker compose up -d          # db + keycloak + api + worker
```

Then open **http://localhost:4000/setup** — the wizard creates your **super admin** (the platform owner). From the super-admin console at **http://localhost:5173**, create your first company.

For the web portal (dev mode):

```bash
npm install                   # workspaces
npm run dev --workspace @provahr/web   # http://localhost:5173 (proxies /api → :4000)
```

For local development without Docker, see [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md).

## What's inside

```
apps/api/          REST API + worker (Express 4 · TypeScript · Prisma · PostgreSQL)
apps/web/          HR console + public board + candidate test portal (React 18 · Vite · Monaco)
apps/mobile/       Candidate app (React Native + Expo — swipe gestures)
packages/shared/   Cross-app TypeScript contracts
deploy/keycloak/   Realm export (provahr) for SSO
docs/              BIBLE (the map of record) · API · RBAC · SELF_HOSTING · DATA_MODEL · TESTING
```

## The product's laws

1. **AI flags, humans decide.** No automated rejection exists anywhere in the codebase.
2. **The pool is sealed.** Question items are encrypted at rest and readable by no user — not even admins.
3. **The clock never pauses.** A test session is one sitting; the deadline is set at start and never extended.
4. **Proof over polish.** Objective marks are instant and shown to the candidate; prose and code go to human-supervised evaluation.
5. **Open source, self-hosted.** Your data, your infrastructure, your rules.

## License

**AGPL-3.0-only** — see [LICENSE](LICENSE) and [NOTICE.md](NOTICE.md).

> ⚠️ **What AGPL means for you:** if you run a modified version of ProvaHR as a network service (SaaS), you must offer the source code of your modifications to its users. This keeps the platform — and any improvements to it — open for everyone. For internal/self-hosted use without modification, the license imposes no obligations beyond keeping the notice.

## Documentation

| Doc | Purpose |
|---|---|
| [docs/BIBLE.md](docs/BIBLE.md) | **The map of record** — architecture, data flow, sequence diagrams, security model |
| [docs/API.md](docs/API.md) | Full endpoint reference (all routes, roles, shapes) |
| [docs/RBAC.md](docs/RBAC.md) | Identity: local, Keycloak, multi-issuer, per-company realms |
| [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) | Install, configure, operate (multi-tenant operator guide) |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | All entities and their relationships |
| [docs/TESTING.md](docs/TESTING.md) | Test strategy, tiers, never-regress list |
| [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) | Founder demo walkthrough (~10 min) |
| [PROGRESS.md](PROGRESS.md) | Living tracker: phases, waves, QA history, backlog |

## Status

- **v1 (single-tenant MVP)** — complete, live-verified end-to-end.
- **v2 (SaaS multi-tenant platform)** — complete: super admin, company onboarding, per-tenant providers/keycloak/sandbox-templates, two-tier prompts.
- **IDE code interviews (D26)** — shipped: Monaco multi-file workspace, Run-in-sandbox, instant objective marking, X-ray truth overlay, pipeline test scores.
- **595 tests green** (578 unit + 17 CI-gated integration).

Post-v2 backlog (tracked in PROGRESS.md): automated Playwright E2E tier, stdin-fed sandbox cases, Stage-enum migration, shared rate-limiter store, docker-socket isolation for multi-tenant sandboxing.

---

**⭐ If you're done paying per seat to test your own candidates — star the repo and self-host.**

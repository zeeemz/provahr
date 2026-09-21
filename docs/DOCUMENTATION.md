# ProvaHR — Documentation System

> How docs stay comprehensive **and** current as the codebase evolves.
> Status: **v2 (ratified 2026-08-29)** · Owner: main harness agent
> **Start here for everything: [`docs/BIBLE.md`](BIBLE.md) — the map of record.**

---

## 1. The rule

**A change is not "done" until code ✚ tests ✚ docs are updated together.**
This is enforced socially (PR checklist) and operationally (Definition of Done
in [`PROGRESS.md`](../PROGRESS.md) §1). Worker agents receive this requirement
in every spec; the main agent verifies it at every phase gate.

## 2. Audience map

| Audience | They need | Primary docs |
|---|---|---|
| Anyone, first contact | The whole system in one map | [`docs/BIBLE.md`](BIBLE.md) (start here) |
| HR / recruiter using an install | How to run hiring on ProvaHR | `docs/guide/` (user guide — not yet created) |
| Self-hoster / IT admin | Install, configure LLM providers, operate | `README.md` · [`docs/SELF_HOSTING.md`](SELF_HOSTING.md) |
| Contributor | Architecture, conventions, where things live | [`docs/BIBLE.md`](BIBLE.md) §2–§3 · [`docs/PLAN.md`](PLAN.md) · CONTRIBUTING |
| Integrator / API consumer | Endpoint reference | [`docs/API.md`](API.md) |
| Compliance / trust reviewer | Fairness & data handling | PLAN §2/§10 · [`docs/DATA_MODEL.md`](DATA_MODEL.md) · SECURITY |

## 3. Canonical doc inventory (single sources of truth)

| File | Purpose | **Must be updated when…** | Status |
|---|---|---|---|
| [`docs/BIBLE.md`](BIBLE.md) | **SSOT hub / map of record** — product, architecture, module map, data flow, sequence diagrams, security model, ops, testing pointer, history, and the topic→doc table | Any structural change to the system, or any §10 canonical doc's scope | ✅ re-verified 2026-09-21 (walk-in/activity/profile/marking; D22–D23; suite 553) |
| `README.md` | Front door: what/why, quickstart, structure, roadmap | Quickstart, structure, or status changes | ✅ current (2026-09-21) |
| `PROGRESS.md` | Master tracker: phases, subtasks, changelog, risks, QA finding tables | **Every work session** | ✅ current (2026-09-21) |
| `docs/PLAN.md` | Product plan of record + ADR/decision log (§12) | Any product/architecture decision is made or changed | ✅ current (2026-09-21 — D5 amendment, D22–D23, post-v2 note in §12.1) |
| `docs/API.md` | Endpoint reference (method, path, auth/role, shapes, error codes) | Any route/DTO change | ✅ current (2026-09-21 — walk-in, details, marking, candidates, activity, pool status) |
| `docs/DATA_MODEL.md` | Entities and field-level docs | Prisma schema changes | ✅ unchanged since 2026-08-29; no migrations 2026-09-20/21 (walk-in/mark/profile are computed surfaces) |
| `docs/TESTING.md` | Test strategy, tiers, never-regress list | Test tiers/tools/policies change | ✅ current (2026-09-21 — §6 #6 marking amendment) |
| `docs/SELF_HOSTING.md` | Install env, provider config (incl. Azure tenant), proxy/rate-limit notes | Deploy story or config surface changes | ✅ current (2026-09-20 — `LLM_TIMEOUT_MS`) |
| `docs/RBAC.md` | Dual-mode auth (local JWT vs Keycloak OIDC), role mapping, Azure AD brokering | Identity surface changes | ✅ current (2026-08-29; no identity changes since) |
| `docs/DOCUMENTATION.md` | This file — the docs system itself | Doc inventory or rules change | ✅ v2 current (2026-09-21) |
| `docs/WALKTHROUGH.md` | Founder demo walkthrough | The demo flow changes | ✅ current (2026-09-21 — walk-in, marking, profile, activity steps) |
| `CONTRIBUTING.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md` · `NOTICE.md` · `LICENSE` | Project mechanics | Process/security posture changes | ✅ current |

`docs/ARCHITECTURE.md`, promised in v1 of this inventory, was never created —
its intended content (modules, data flows, sandbox, LLM layer) is **absorbed
into `docs/BIBLE.md` §2–§3 and §5–§6**; there is no separate architecture doc
to write unless the bible outgrows itself.

Rules:

- **One source of truth per topic** — the table in `docs/BIBLE.md` §10 maps
  every topic to its canonical doc. Other docs *link*, never copy-and-drift.
- Every guide carries a `Last verified: YYYY-MM-DD` line, refreshed when
  re-checked against reality; anything older than 90 days is flagged in a
  docs audit.
- New doc types must be added to this inventory in the same PR that creates
  them — an unlisted doc is a bug.

## 4. Keeping docs honest (mechanisms)

1. **PR checklist item**: "Docs updated? (see `docs/DOCUMENTATION.md` inventory)".
2. **Tested examples**: any request/response example in `docs/API.md` must be
   exercised by a contract test; if the example breaks, CI breaks.
3. **Phase-gate doc reconciliation**: the main agent's verification pass at
   each phase includes "do the docs still describe reality?" — recorded in the
   `PROGRESS.md` changelog.
4. **Code is the tiebreaker** (stated in BIBLE §10): when docs and code
   disagree, the code wins and the doc is a bug — fix the doc, not the reader.
5. **Decisions are append-only**: product/architecture changes append to PLAN
   §12 (ADR style) — history is never rewritten, only superseded entries are
   marked.

## 5. Writing standards

- Plain, concrete English; short sentences; no marketing voice in technical
  docs (README tagline excepted).
- Every claim about *behavior* cites where it lives (file path or endpoint).
- Diagrams as ASCII in-repo (reviewable in diffs); rendered diagrams only if
  they earn their maintenance cost. The bible's diagrams (§2 architecture,
  §4 data flow, §5 sequences) are the canonical set.
- Docs are Apache-2.0 licensed content like everything else — keep them
  contributor-friendly.

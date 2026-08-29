# ProvaHR — Documentation System

> How docs stay comprehensive **and** current as the codebase evolves.
> Status: **v1 (ratified 2026-08-29)** · Owner: main harness agent

---

## 1. The rule

**A change is not "done" until code ✚ tests ✚ docs are updated together.**
This is enforced socially (PR checklist) and operationally (Definition of Done
in [`PROGRESS.md`](../PROGRESS.md) §1). Worker agents receive this requirement
in every spec; the main agent verifies it at every phase gate.

## 2. Audience map

| Audience | They need | Primary docs |
|---|---|---|
| HR / recruiter using an install | How to run hiring on ProvaHR | `docs/guide/` (user guide, from Phase 4) |
| Self-hoster / IT admin | Install, configure LLM providers, operate | README · `docs/SELF_HOSTING.md` (from Phase 1) |
| Contributor | Architecture, conventions, where things live | README · CONTRIBUTING · `docs/PLAN.md` · `docs/ARCHITECTURE.md` |
| Integrator / API consumer | Endpoint reference with examples | `docs/API.md` (generated examples tested — §4) |
| Compliance / trust reviewer | Fairness & data handling | PLAN §2/§10 · `docs/DATA_MODEL.md` · SECURITY |

## 3. Canonical doc inventory (single sources of truth)

| File | Purpose | **Must be updated when…** | Status |
|---|---|---|---|
| `README.md` | Front door: what/why, quickstart, structure | Quickstart, structure, or status changes | ✅ current |
| `PROGRESS.md` | Master tracker: phases, subtasks, changelog, risks | **Every work session** | ✅ current |
| `docs/PLAN.md` | Product plan of record + ADR/decision log (§12) | Any product/architecture decision is made or changed | ✅ v4 current |
| `docs/TESTING.md` | Test strategy + per-phase test contract | Test tiers/tools/policies change | ✅ v1 current |
| `docs/DOCUMENTATION.md` | This file — the docs system itself | Doc inventory or rules change | ✅ v1 current |
| `docs/DATA_MODEL.md` | Entities and field-level docs | Prisma schema changes | ⚠️ **stale (pre-v4)** — banner added; rewrite lands with Phase 2–3 entities |
| `docs/ARCHITECTURE.md` | Deep-dive: modules, data flows, sandbox, LLM layer | Module boundaries or flows change | ⬜ created at Phase 1 |
| `docs/API.md` | Endpoint reference | Any route/DTO change | ⬜ created at Phase 2 |
| `docs/SELF_HOSTING.md` | Install, provider config (incl. Azure tenant), upgrades, backup | Deploy story or config surface changes | ⬜ created at Phase 1 |
| `CONTRIBUTING.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md` · `NOTICE.md` · `LICENSE` | Project mechanics | Process/security posture changes | ✅ current |

Rules:

- **One source of truth per topic.** Other docs *link*, never copy-and-drift.
  (PLAN §11's phase table is the canonical roadmap; README summarizes it.)
- Every guide carries a `Last verified: YYYY-MM-DD` line, refreshed when
  re-checked against reality; anything older than 90 days is flagged in a
  docs audit.
- New doc types must be added to this inventory in the same PR that creates
  them — an unlisted doc is a bug.

## 4. Keeping docs honest (mechanisms)

1. **PR checklist item**: "Docs updated? (see `docs/DOCUMENTATION.md` inventory)".
2. **Tested examples**: any request/response example in `docs/API.md` must be
   exercised by a contract test; if the example breaks, CI breaks (from the
   Phase 2 API reference onward).
3. **Phase-gate doc reconciliation**: the main agent's verification pass at
   each phase includes "do the docs still describe reality?" — recorded in the
   `PROGRESS.md` changelog.
4. **Stale banners** (like `DATA_MODEL.md`'s today) make decay *visible*
   instead of silently wrong.
5. **Decisions are append-only**: product/architecture changes append to PLAN
   §12 (ADR style) — history is never rewritten, only superseded entries are
   marked.

## 5. Writing standards

- Plain, concrete English; short sentences; no marketing voice in technical
  docs (README tagline excepted).
- Every claim about *behavior* cites where it lives (file path or endpoint).
- Diagrams as ASCII in-repo (reviewable in diffs); rendered diagrams only if
  they earn their maintenance cost.
- Docs are Apache-2.0 licensed content like everything else — keep them
  contributor-friendly.

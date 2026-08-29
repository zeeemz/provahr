# @provahr/web

Web frontend for ProvaHR: the HR console, the public job board, and the candidate
test portal (including proctored sessions). React 18 + Vite + TypeScript, plain
CSS — no UI framework. See `docs/PLAN.md` §4 (the loop this app mirrors) and §7.

## Scripts

- `npm run dev` — Vite dev server on :5173 with a same-origin `/api` proxy to
  `http://localhost:4000` (run the API with `npm run dev:api` from the root).
- `npm run typecheck` — `tsc --noEmit` (strict).
- `npm run build` — production bundle to `dist/`.
- `npm run preview` — serve the built bundle.

## Map

- `src/public/` — board (`/`), job detail + apply (`/jobs/:id`), and the test
  flow (`/test/:token`): consent → one-question-at-a-time session (SWIPE_MCQ /
  MCQ / WRITTEN / CODE, autosaved answers, never-pausing clock, batched
  tab-switch / large-paste signals) → "Submitted ✓" and nothing else.
- `src/hr/` — login/register, dashboard (`/app`), roles + intake wizard
  (`/app/jobs`), job console (JD → blueprint → samples → sealed pool →
  publish), pipeline, and the application X-ray.
- `src/api/` — typed fetch client (`ApiError` with `code`/`message`, Bearer
  token in localStorage `provahr_token`) and DTOs mirroring the API routers.

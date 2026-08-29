# ProvaHR candidate mobile app (`@provahr/mobile`)

React Native + Expo + TypeScript candidate app — PLAN.md Phase 6 / decision D13.
Same API contract as the web portal (`apps/web`): browse open roles, apply
(issues the one-time test link), consent, then take the proctored skill test —
with **Swipe MCQ as a native swipe deck** and **signal parity** (app-background
instead of tab-switch).

## Run it

```bash
# from the repo root (npm workspaces — deps are already installed there)
npm run start --workspace @provahr/mobile     # = npx expo start (inside apps/mobile)

# or directly:
cd apps/mobile && npx expo start
```

Then press `a` (Android emulator/device), `i` (iOS simulator), or scan the QR
code with Expo Go. The API must be running: `npm run dev:api` from the repo
root (see the root README for the database/setup prerequisites).

> If the workspace install is ever missing the Expo toolchain, run
> `npx expo install` inside `apps/mobile` once (it pins the exact SDK 51
> versions already declared in `package.json`).

### Talking to the API from a device

The API base URL comes from `app.json` → `expo.extra.apiUrl`
(default `http://localhost:4000`, the `apps/api` dev port).

- **Emulator/simulator:** `localhost` works as-is.
- **Physical phone via Expo Go:** replace `apiUrl` with your computer's LAN IP
  (e.g. `http://192.168.1.20:4000`) or use `adb reverse tcp:4000 tcp:4000`
  on Android. Cleartext HTTP is already permitted by the app manifest.

`npx expo start` picks up `app.json` edits on restart.

## What it implements

- **JobBoard** — `GET /api/public/jobs` (search box → `?q=`, pull-to-refresh),
  plus an "enter your test code" entry for links issued outside the app.
- **JobDetail + Apply** — `GET /api/public/jobs/:id`, `POST .../apply` with the
  same field set/limits as web. The one-time test token is shown once:
  selectable text + copy (`expo-clipboard`) + direct start.
- **Test flow** — `GET /api/public/test/:token` consent meta (with the
  platform-honest monitoring disclosure), `POST .../start` (idempotent),
  refresh-safe `GET .../session`, `POST .../answers`, `POST .../signals`,
  `POST .../submit` → nothing but **"Submitted ✓"** (asymmetry is the product).
- **TestSession** — format-aware: `SWIPE_MCQ` renders a card deck
  (swipe right = LIKE, left = DISLIKE, plus tap-toggle buttons and numbered
  chips for the bounded review pass); `MCQ` tap-select; `WRITTEN`/`CODE`
  multiline autosave (900 ms debounce). Countdown from `meta.deadlineAt`,
  auto-submit at zero inside the API's 60 s grace window, answers POST per
  change, question stepper for review.
- **Signals** — `APP_BACKGROUND` via React Native `AppState` (the web
  `TAB_SWITCH` equivalent), `LARGE_PASTE` approximated by a >500-char
  instantaneous insertion (RN has no paste event), batched and flushed every
  10 s, at submit, and immediately when the app backgrounds (the OS may kill
  the process). Evidence-only: a failed flush is dropped, never blocking.

## Type checking

```bash
cd apps/mobile && npx tsc --noEmit
```

Strict; `noUnusedLocals`/`noUnusedParameters` on. Types come from React
Native 0.74's bundled declarations (`@types/react-native` is not used — it
stops at 0.73 and RN ships its own since 0.74).

## Honest scope notes

- **No emulator/simulator was available on the build machine** — this app is
  verified by strict `tsc --noEmit` (twice, zero errors) and by contract
  mirroring of `apps/web/src/public/TestFlow.tsx`, not by a live device run.
  Run `npx expo start` to exercise it for real.
- Candidate-only surface (PLAN §3): no auth, no HR console, no X-ray.
- Navigation is a minimal in-repo stack (board → detail → test) rather than
  `react-navigation` — three screens deep, keeping the native dependency
  surface small.
- A submit network error keeps the session screen alive with a retry (web
  swaps to an error screen); everything else mirrors the web flow.

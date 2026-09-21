# ProvaHR — Founder Demo Walkthrough

> Fresh-install walkthrough of the SaaS platform. ~10 minutes.
> Stack: `docker compose up -d` + web dev server at http://localhost:5173.

## 1. First run — the platform boots empty

- Open **http://localhost:4000/setup** → the wizard creates the **Super Admin only** (no company — that's the SaaS model).
- Sign in at **http://localhost:5173** → you land on the **Platform console** (not a company console).

## 2. Platform console (super admin)

- **Companies** → "New company" wizard: name + optional first admin (email + password + role). This is tenant onboarding.
- **Auth mode** → the runtime local ↔ Keycloak switch (data-backed; no .env editing).
- **Oversight lists** → every company's Keycloak configs and sandbox templates.

## 3. Company console (tenant admin)

Sign in as the company admin you just created:

- **Admin → Providers** — add an LLM provider (OpenAI / Anthropic / Azure / Ollama-compatible), **Activate**, **Test** (inline latency + reply). Keys are encrypted at rest and only ever shown as `••••1234`.
- **Admin → Team** — invite RECRUITERs and INTERVIEWERs; role gating is enforced server-side.
- **Admin → Auth (Settings)** — the company's own Keycloak realm (issuer + audience), configured **in the portal**. Flip the platform to OIDC and watch: company local logins get `SSO_MODE_ACTIVE`, while the **super admin still signs in** (lockout carve-out — flip back after showing it).
- **Admin → Sandbox templates** — per-language execution images (e.g. swap BASH to `bash:5.2.37`); unsafe image refs are rejected.

## 4. The AI-native loop

- **Jobs → New from profile**: notes (+ optional public URLs / up to 5 screenshots) → the worker drafts a **JD** → edit → **Approve**.
- **Blueprint** the test (topics, formats incl. Swipe-MCQ/code, time limit) → **Seal pool** (≥6× draw, encrypted — nobody, not even admins, can enumerate it; the step shows live progress while the worker generates) → sample preview → **Publish**.
- **Activity** (top nav): the live background log — watch the JD draft, sample runs and the pool seal move through queued → running → done, with retries and errors if a provider misbehaves.
- **Be the candidate** (incognito): board → apply → the **one-time test link** (shown exactly once) → consent (honest monitoring disclosure) → the test: swipe cards, code editor, countdown that never pauses → submit → *"Submitted ✓"* **plus instant marking on the multiple-choice part** ("2 of 3 correct · 1 partial · 1 written/coding answer awaiting evaluation").
- **Or do it as a walk-in** (the office flow): on the job's **Pipeline** page click **"+ Walk-in candidate"** → type the visitor's name/email → **"Open the test now"** → hand over the keyboard: the candidate completes their own details, then takes the same proctored test.
- **Be HR again**: the application **X-ray** — per-answer verdicts, the code's **real sandbox execution** (stdout, exit codes, hidden-case passes), AI-likelihood *flags*, signals — then move the candidate through the human pipeline (rejection requires a human reason; AI can never reject).
- **"test profile →"** (on any pipeline row or application page): the candidate's story across ALL your roles — scores, per-format strengths/weaknesses, flags. Flunked one role? They can still apply to any other; the profile informs, never blocks.

## Things worth saying out loud while clicking

- The candidate's code ran in a hardened container (no network, read-only, non-root) against hidden cases.
- The question pool is structurally invisible — enforced by architecture and a CI canary matrix.
- Every "AI decides" moment ends at a human gate. That's the product's law.
- Instant marking is deterministic only (MCQ / swipe) — written and code answers still go to human-side evaluation, and the candidate is told exactly that.

## Reset for a fresh demo

```bash
docker compose down -v && docker compose up -d
```

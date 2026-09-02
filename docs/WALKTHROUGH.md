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
- **Blueprint** the test (topics, formats incl. Swipe-MCQ/code, time limit) → **Seal pool** (≥6× draw, encrypted — nobody, not even admins, can enumerate it) → sample preview → **Publish**.
- **Be the candidate** (incognito): board → apply → the **one-time test link** (shown exactly once) → consent (honest monitoring disclosure) → the test: swipe cards, code editor, countdown that never pauses → submit → *"Submitted ✓"* — nothing else (asymmetry).
- **Be HR again**: the application **X-ray** — per-answer verdicts, the code's **real sandbox execution** (stdout, exit codes, hidden-case passes), AI-likelihood *flags*, signals — then move the candidate through the human pipeline (rejection requires a human reason; AI can never reject).

## Things worth saying out loud while clicking

- The candidate's code ran in a hardened container (no network, read-only, non-root) against hidden cases.
- The question pool is structurally invisible — enforced by architecture and a CI canary matrix.
- Every "AI decides" moment ends at a human gate. That's the product's law.

## Reset for a fresh demo

```bash
docker compose down -v && docker compose up -d
```

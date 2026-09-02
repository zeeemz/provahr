# Self-Hosting ProvaHR (multi-tenant operator guide)

Last verified: 2026-08-31

This guide covers running ProvaHR on your own infrastructure. Since v2 (D18)
one install is a **platform**: the first run creates a **super admin**, and
that account creates **companies (tenants)** — each with its own LLM keys
(D20), its own Keycloak realm (D19) and its own sandbox images (D21). You can
run it for a single company (create one tenant and stop) or host many.

## Prerequisites

- **Node.js >= 20** (22 recommended) and npm, or Docker using the repo's
  compose stack.
- **PostgreSQL 14+** — the API stores everything (tenants, jobs, applications,
  scores, and the encrypted LLM provider credentials) in one database.
- An account with an LLM provider you control (see below) if a tenant wants
  the AI-assisted features; everything else works without one.
- The first-run wizard at `/setup` (creates the **super admin**, not a
  company — companies come from the platform console afterwards).

## First run: platform bootstrap

1. Start the stack (see [Compose](#compose-the-full-stack) or the scripts:
   `bash scripts/install.sh` / `scripts/install.cmd`).
2. Open `http://localhost:4000/setup` — create the **super admin** (name,
   email, password). The wizard hard-locks itself after this; the install
   counts as configured once the super admin exists.
3. Sign in as the super admin → **Platform → Companies → + New company**:
   name, optional website, and (recommended) the tenant's first **ADMIN**
   name/email/password — created in one request. That admin signs in at
   `/login` and runs the company from the inside.
4. Inside each company, its ADMIN configures: **Admin → Providers** (LLM
   keys — below), **Admin → Auth** (the company's Keycloak realm —
   [RBAC.md](RBAC.md)), **Admin → Settings** (sandbox image templates —
   below). The platform super admin additionally controls the install-wide
   sign-in mode under **Platform → Settings** (local ⇄ SSO, a runtime
   switch — no restart).

Deleting a tenant (**Platform → Companies → Delete**) cascades its users,
jobs and all downstream hiring data. Renames keep the slug stable.

## Environment variables — the `.env` truth

`.env` files are **not auto-loaded**: nothing in the API imports dotenv (a
finding of the 2026-08-29 E2E live run). The scripts create `apps/api/.env`
from `.env.example` as a convenient place to keep values, but the running
process only sees **actual environment variables** — use docker compose
(explicit `environment:`), inline env (`DATABASE_URL=… npm run dev`), or your
shell profile. A `--env-file` switch for the dev scripts is a tracked backlog
item.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string, e.g. `postgresql://postgres:postgres@localhost:5432/hiring_platform?schema=public` |
| `JWT_SECRET` | yes | Signs local login tokens (super admin + local mode). Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SECRETS_KEY` | yes in production | Encrypts LLM provider API keys at rest (AES-256-GCM). Generate the same way as `JWT_SECRET` — **use the generator, not a human passphrase** (the key derivation has no stretching). Must be at least 16 characters. With `NODE_ENV=production` the API refuses to boot on the development default. |
| `NODE_ENV` | no | `development` (default) / `test` / `production` |
| `PORT` | no | API port (default `4000`) |
| `JWT_EXPIRES_IN` | no | Local-mode login token lifetime (default `12h`) |
| `CORS_ORIGIN` | no | Comma-separated frontend origins (default `http://localhost:5173`), or `*` |
| `WORKER_POLL_MS` | no | Worker idle poll interval (default `2000`) |
| `OIDC_ENABLED` | no | **Fallback only** (D19): the auth mode when no `PlatformSettings` row exists. The live mode is the platform setting (`Platform → Settings`). |
| `OIDC_ISSUER_URL` | no | **Platform-default issuer fallback**: verifies SSO tokens whose `iss` matches no company config, e.g. `http://localhost:8081/realms/provahr` |
| `OIDC_AUDIENCE` | no | Platform-default expected audience (default `provahr-api`) |

Per-company Keycloak issuers/audiences are **data** (`company_auth_configs`),
managed in the portal by each tenant's admin — never env, never a restart.

Generation commands:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice — once for `JWT_SECRET`, once for `SECRETS_KEY`. Do not reuse one
value for both.

## Configure a company's LLM provider

Provider credentials are managed by each company's admin through the
`/api/admin/llm-providers` endpoints (JSON REST, authenticated with that
company's admin login token). Providers are **company-scoped** (D20): every
query filters by the caller's company, another tenant's provider is
indistinguishable from a missing one, and **exactly one provider is active per
company**. The API key is encrypted with `SECRETS_KEY` before it touches the
database and is never returned by any endpoint — responses show only its
last 4 characters.

All examples below assume `API=http://localhost:4000` and `TOKEN` is a
**company ADMIN** Bearer token.

### 1. OpenAI-compatible (OpenAI, OpenRouter, Ollama, vLLM, LM Studio)

One kind covers every API that mirrors OpenAI's `/chat/completions`:

```bash
curl -X POST "$API/api/admin/llm-providers" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "kind": "OPENAI_COMPATIBLE",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-...",
    "textModel": "gpt-4o-mini",
    "isActive": true
  }'
```

- `baseUrl` must include the version segment where the backend uses one:
  OpenAI `https://api.openai.com/v1`, OpenRouter `https://openrouter.ai/api/v1`,
  vLLM `http://localhost:8000/v1`, LM Studio `http://localhost:1234/v1`.
  Leave it out to use OpenAI's default. For local Ollama use
  `http://localhost:11434/v1` with any `apiKey` (Ollama ignores it, but the
  field requires at least 8 characters).
- `textModel` is the model id (`gpt-4o-mini`, `meta-llama/Llama-3.1-8B-Instruct`, ...).
- Note: JSON-mode support varies by backend. OpenAI accepts
  `response_format: json_object`; Ollama/vLLM/LM Studio may ignore or reject
  it. Features that ask for JSON degrade to prompt-based JSON on such
  backends only when the provider supports no JSON mode at all — test with
  the smoke-test endpoint below before relying on it.

### 2. Anthropic (native)

```bash
curl -X POST "$API/api/admin/llm-providers" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "kind": "ANTHROPIC",
    "baseUrl": "https://api.anthropic.com",
    "apiKey": "sk-ant-...",
    "textModel": "claude-sonnet-4-20250514",
    "isActive": true
  }'
```

- `baseUrl` can be omitted (defaults to `https://api.anthropic.com`; the API
  appends `/v1/messages` itself).
- Anthropic has no native JSON mode; the API emulates it with a system-prompt
  instruction, so no extra configuration is needed.

### 3. Azure OpenAI (your own tenant)

```bash
curl -X POST "$API/api/admin/llm-providers" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "kind": "AZURE_OPENAI",
    "baseUrl": "https://<your-resource>.openai.azure.com",
    "apiKey": "<resource key>",
    "textModel": "<deployment-name>",
    "isActive": true
  }'
```

- `baseUrl` is the **resource URL** (`https://<your-resource>.openai.azure.com`) —
  required, there is no default.
- `textModel` is the **deployment name** you created in Azure AI Foundry /
  the portal — not the underlying model id. The adapter addresses
  `/openai/deployments/<deployment-name>/chat/completions`.
- The `api-version` query parameter is fixed by the adapter (`2024-10-21`);
  you cannot and do not need to set it.

### Activating exactly one provider (per company)

You can register several providers per company, but **exactly one is active
per company** — the one that company's AI features use. Activation is atomic
(the company's others are deactivated in the same transaction); other
companies are untouched:

```bash
curl -X POST "$API/api/admin/llm-providers/<id>/activate" \
  -H "Authorization: Bearer $TOKEN"
```

Creating a provider with `"isActive": true` also deactivates the previous
one. There is deliberately no "deactivate" endpoint. The only way to end up
with zero active providers is deleting the active row — a deliberate act with
a well-defined result: that company's AI features fail with a clear
`NO_PROVIDER` error until another one is activated. (Deleting and re-adding a
provider is the correct way to switch credentials wholesale.)

Note: `visionModel` is stored and shown for future phases (screenshot-based
JD generation) but does not yet route image traffic — image requests
currently go through `textModel`.

### Smoke testing a provider

Before relying on a provider, send a minimal real request through it:

```bash
curl -X POST "$API/api/admin/llm-providers/<id>/test" \
  -H "Authorization: Bearer $TOKEN"
```

A healthy provider returns quickly with something like:

```json
{ "ok": true, "model": "gpt-4o-mini", "latencyMs": 812, "reply": "OK" }
```

Failures return an `LLM_ERROR` (HTTP 502 from ProvaHR regardless of the
provider's own status, which appears in the error message — retries are
automatic for 429/5xx) and never include your API key.

Other management endpoints: `GET /api/admin/llm-providers` (list, redacted),
`PATCH /api/admin/llm-providers/<id>` (edit; omit `apiKey` to keep the stored
one), `DELETE /api/admin/llm-providers/<id>`.

## Per-company sandbox image templates (D21)

A company's ADMIN can override, per CODE language (BASH / NODE / PYTHON),
which docker image runs that company's code-test answers — e.g. a Java
exercise image. Managed under **Admin → Settings** (`GET/PUT
/api/admin/sandbox-templates`):

- A row shows `defaultImage` (the platform default: `bash:5.2`,
  `node:20-alpine`, `python:3.12-alpine`), the stored template, and the
  **resolved** `activeImage` (`activeSource: COMPANY | PLATFORM`) —
  missing/disabled/unsafe rows fall back to the platform default.
- `image` must be a **lowercase docker reference** (registry, optional
  `:port`, path, optional `:tag`, ≤100 chars). Uppercase names, flags,
  whitespace and digests are refused — at save time and again at build time.
- **Hardening is identical for every image**: an override changes *which*
  container runs, never *how* it runs (no network, read-only rootfs, non-root
  user, resource caps — enforced by the byte-identical hardened argv).
- The platform super admin sees every tenant's resolved images read-only
  under **Platform → Sandbox templates**.

## Per-company Keycloak (D19)

Each company configures its own Keycloak realm as data under **Admin → Auth**
(`GET/PUT /api/admin/auth-config`): issuer URL, audience (client id), and an
enabled flag (a disabled row authenticates nobody — drafts are free). The
install-wide local ⇄ SSO switch is the super admin's **Platform → Settings**
(runtime, no restart). The realm/client/role-mapping walkthrough and the
multi-issuer resolution rules live in [RBAC.md](RBAC.md).

## Compose: the full stack

`docker compose up -d --build` starts:

- `db` — postgres:16 (health-checked; all data incl. tenants lives here),
- `keycloak` — 26.0, dev-file H2, realm JSON imports from `deploy/keycloak/`
  (drop exports there), port 8081,
- `api` — built from `apps/api/Dockerfile`, `NODE_ENV=production`,
  **migrate-on-boot** (`prisma migrate deploy`; the prisma CLI is baked in),
  port 4000,
- `worker` — same image, ALSO **migrate-on-boot** (so a fresh volume can
  never race the API's boot-time migration — an E2E catch), and it mounts
  `/var/run/docker.sock` for CODE-answer execution (see below).

**Change every shipped default** before real use: the Postgres password, both
Keycloak bootstrap admin credentials, `JWT_SECRET`, and `SECRETS_KEY` (the
compose file uses distinct dev values so the production boot guard allows
startup — they are still public placeholders).

**Docker socket security note.** The worker runs candidate code through the
HOST's docker daemon (docker-outside-of-docker). Every run is hardened
(network-off, read-only, non-root, resource-capped, output/time-limited), but
the mounted socket is root-equivalent on the host, and all tenants share one
daemon and kernel. That is an accepted v1 trade-off for a single-operator
self-host; per-tenant socket isolation is tracked in the post-v2 backlog.

## Security notes

- **Encryption at rest.** API keys are sealed with AES-256-GCM
  (`v1.<iv>.<authTag>.<ciphertext>`, random 12-byte IV per save) before being
  written to the `llm_providers` table. The key is derived from `SECRETS_KEY`.
- **Keys never leave the box.** No endpoint returns the API key or its
  ciphertext — listing shows only `apiKeyLast4`. Error messages from provider
  calls are scrubbed of the key before being surfaced.
- **`SECRETS_KEY` rotation invalidates stored keys — by design.** There is no
  key-encryption-key hierarchy: if you change `SECRETS_KEY`, every stored
  provider key becomes undecryptable and the API fails loudly with
  `CRYPTO_ERROR`. Re-enter the provider credentials afterwards. Back up the
  key the same way you back up `JWT_SECRET`.
- **Tenant isolation.** Every company-scoped query filters on the caller's
  `companyId`; cross-tenant reads answer the same 404 as missing ones. The
  super admin owns the platform but cannot reach company-scoped surfaces.
- Generate both secrets offline, store them in your secret manager, and keep
  them out of version control. `.env.example` values are placeholders.

## Reverse proxies and rate limiting

The public endpoints (apply, test links) rate-limit per IP **in memory, per
API process**. Two consequences when you front the API with a TLS proxy:

1. Without `trust proxy`, every candidate shares the proxy's IP — one shared
   20/minute bucket (self-DoS under load).
2. Enabling `trust proxy` blindly lets clients spoof `X-Forwarded-For` unless
   your proxy **strips inbound XFF** before setting its own.

For a single-instance deployment behind a proxy: enable `trust proxy` AND
configure the proxy to overwrite (not append) the header. For multi-instance
deployments the in-memory limiter needs a shared store — tracked in the
post-v2 hardening backlog (PROGRESS.md).

# Self-Hosting ProvaHR

Last verified: 2026-08-29

This guide covers running the ProvaHR API on your own infrastructure: the
environment it needs, and how to configure the LLM provider that powers
AI-assisted features (decision D9: your own keys, your own tenant — exactly one
active provider at a time).

## Prerequisites

- **Node.js >= 20** (22 recommended) and npm, or Docker using the repo's images.
- **PostgreSQL 14+** — the API stores everything (jobs, applications, scores,
  and the encrypted LLM provider credentials) in one database.
- An account with an LLM provider you control (see below) if you want the
  AI-assisted features; everything else works without one.
- Completed the first-run setup wizard at `/setup` (creates the company and
  the first admin account).

## Environment variables

All variables live in `apps/api/.env` (copy from `.env.example`).

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL connection string, e.g. `postgresql://postgres:postgres@localhost:5432/hiring_platform?schema=public` |
| `JWT_SECRET` | yes | Signs local login tokens. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `SECRETS_KEY` | yes in production | Encrypts LLM provider API keys at rest (AES-256-GCM). Generate the same way as `JWT_SECRET` — **use the generator, not a human passphrase** (the key derivation has no stretching). Must be at least 16 characters. With `NODE_ENV=production` the API refuses to boot on the development default. |
| `NODE_ENV` | no | `development` (default) / `test` / `production` |
| `PORT` | no | API port (default `4000`) |
| `JWT_EXPIRES_IN` | no | Local-mode login token lifetime (default `12h`) |
| `CORS_ORIGIN` | no | Comma-separated frontend origins (default `http://localhost:5173`), or `*` |
| `OIDC_ENABLED` | no | `false` (default) = local email/password auth; `true` = Keycloak/OIDC |
| `OIDC_ISSUER_URL` | no | OIDC issuer, e.g. `http://localhost:8081/realms/provahr` (trailing slashes are stripped automatically) |
| `OIDC_AUDIENCE` | no | Expected token audience (default `provahr-api`) |

Generation commands:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Run it twice — once for `JWT_SECRET`, once for `SECRETS_KEY`. Do not reuse one
value for both.

## Configure an LLM provider

Provider credentials are managed by an admin through the
`/api/admin/llm-providers` endpoints (JSON REST, authenticated with an admin
login token). The API key is encrypted with `SECRETS_KEY` before it touches
the database and is never returned by any endpoint — responses show only its
last 4 characters.

All examples below assume `API=http://localhost:4000` and `TOKEN` is an admin
Bearer token.

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

Uses your Azure OpenAI resource with key authentication:

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

- `baseUrl` is the **resource URL** (`https://<resource>.openai.azure.com`) —
  required, there is no default.
- `textModel` is the **deployment name** you created in Azure AI Foundry /
  the portal — not the underlying model id. The adapter addresses
  `/openai/deployments/<deployment-name>/chat/completions`.
- The `api-version` query parameter is fixed by the adapter (`2024-10-21`);
  you cannot and do not need to set it.

## Activating exactly one provider

You can register several providers, but **exactly one is active** — the one
every AI feature uses. Activation is atomic (all others are deactivated in
the same transaction):

```bash
curl -X POST "$API/api/admin/llm-providers/<id>/activate" \
  -H "Authorization: Bearer $TOKEN"
```

Creating a provider with `"isActive": true` also deactivates the previous
one. There is deliberately no "deactivate" endpoint. The only way to end up
with zero active providers is deleting the active row — a deliberate act with
a well-defined result: AI features fail with a clear `NO_PROVIDER` error until
you activate another one. (Deleting and re-adding a provider is the correct
way to switch credentials wholesale.)

Note: `visionModel` is stored and shown for future phases (screenshot-based
JD generation) but does not yet route image traffic — image requests
currently go through `textModel`.

## Smoke testing a provider

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
Phase 10 hardening pass (PROGRESS.md).

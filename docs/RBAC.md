# RBAC & Authentication (D15 + D18/D19)

Last verified: 2026-08-31

ProvaHR is a **multi-tenant platform** (D18) with a single `requireAuth`
middleware and two interchangeable verification modes — and since V2-3 (D19)
*which mode runs* and *who verifies an SSO token* are **data**, configurable in
the portal at runtime. There is no "edit `.env` and restart the API" step
anywhere in the auth story anymore.

## The three actors

| Actor | Who | Authenticated by | Scope |
|---|---|---|---|
| `SUPER_ADMIN` | The platform owner (created by the first-run wizard) | **Always local** (email + password, HS256 JWT) — the lockout carve-out, see below | `companyId: null`; only `/api/platform/*` (tenants, settings, oversight) |
| Company users: `ADMIN` / `RECRUITER` / `INTERVIEWER` | Members of a tenant | Local mode: email + password. SSO mode: the **company's** Keycloak realm | Their company (`req.user.companyId`) |
| Candidate | No account, never Keycloak | One-time test token (hash-looked-up) | Public board + their session only |

## The two modes — and where the switch lives

`requireAuth` (in `apps/api/src/middleware/auth.ts`) resolves the mode **per
request** from the `platform_settings` singleton row (10-second in-memory
cache; a portal write refreshes the cache immediately):

| | Local mode (default) | SSO mode (`oidc`) |
|---|---|---|
| Credential | Email + password against the local Postgres user table | OIDC access token issued by a Keycloak realm |
| Token | HS256 JWT signed with `JWT_SECRET`, subject = user id | RS256 JWT signed by the issuer's private key |
| Verification | `JWT_SECRET` shared secret + live user lookup | Per-issuer JWKS (RS256, issuer + audience checked) |
| Company users' rows | Created by wizard/admin | Provisioned/synced from the verified token on every request |
| Switch lives in | Platform console → Settings (`PUT /api/platform/settings`) — effective on the **next request**, no restart | same |

The boot-time env (`OIDC_ENABLED`) is now only the **fallback**: it decides
the mode when no settings row exists (e.g. a `db push` database) or the
database is unreadable — the mode read deliberately fails open rather than
500-ing the login page. `GET /api/auth/mode` (public) returns
`{ mode, perCompany }` — `perCompany: true` once any company has an *enabled*
Keycloak config.

## The wizard v3 flow (first run → tenants)

1. Fresh install → `http://localhost:4000/setup` — the self-locking wizard
   creates the **SUPER_ADMIN only** (no company). The install counts as
   configured once a super admin exists; `POST /api/setup/install` 409s and
   `POST /api/auth/register` 409s after that.
2. The super admin signs in (local, always) and lands on the platform console:
   **Platform → Companies → + New company** creates a tenant, optionally with
   its first ADMIN (`POST /api/platform/companies` with `firstAdmin` — one
   transaction; the admin's credentials mirror the team-invite form).
3. Each company's ADMIN signs in at `/login` and configures the tenant from
   the inside: **Admin → Providers** (its own LLM keys, D20), **Admin → Auth**
   (its own Keycloak realm below, D19), **Admin → Settings** (sandbox image
   templates, D21).

## Per-company Keycloak (D19) — configured in the PORTAL, not `.env`

Each company owns **one** `CompanyAuthConfig` row (`GET/PUT
/api/admin/auth-config`, ADMIN-only, scoped to the caller's company):

- `issuerUrl` — the realm's issuer identifier (the token's `iss` claim; a
  trailing slash is normalized away).
- `audience` — the Keycloak client id whose tokens ProvaHR accepts.
- `enabled` — a disabled row authenticates **nobody**: save a draft first,
  flip the toggle when the realm is ready. Disabling is an instant off-switch
  for that tenant; re-enabling is one PUT away.

Rules enforced by the API:

- One **enabled** config per issuer across all companies (**409
  `ISSUER_TAKEN`** pre-check + a migration-managed partial unique index,
  migration 0004) — issuer resolution must map `iss` → exactly one tenant.
- The env pair `OIDC_ISSUER_URL` / `OIDC_AUDIENCE` remains the
  **platform-default realm** fallback for tokens whose issuer matches no
  company config (single-realm installs keep working with zero portal
  configuration).

### Multi-issuer resolution (how an SSO token finds its verifier)

For a token that is not a valid local JWT, `requireAuth` → `resolveOidcConfig`:

1. Decode the token's `iss` claim **without signature verification** — used
   ONLY to *select* a stored configuration, never to trust a claim or build a
   URL (same trust shape as the pre-existing `kid` → JWKS lookup: untrusted
   input picks key material from trusted storage; the crypto binds them).
2. An **enabled** `CompanyAuthConfig` with a matching `issuerUrl` wins → the
   token must verify against that config's issuer + audience + JWKS, and the
   provisioned user joins **that company**.
3. Otherwise, if `iss` equals the env `OIDC_ISSUER_URL`, the env
   issuer/audience verify it (platform-default realm; user joins the first
   company — V2-1 behavior).
4. Anything else → **401 `UNAUTHENTICATED`** (unknown issuer).
5. A database error degrades to branch 3: a company-issuer token cannot match
   the env issuer, so tenant tokens fail **closed** while the platform default
   keeps working.

### The two lockout carve-outs in SSO mode (founder requirement)

1. **The SUPER_ADMIN always authenticates locally.** A broken Keycloak
   config must never lock the platform owner out of the portal that fixes it.
   (Passing this branch still requires a valid `JWT_SECRET` signature — an
   attacker cannot use it to skip verification.)
2. **Company users cannot ride local tokens in SSO mode.** A company user's
   locally-signed token gets **403 `SSO_MODE_ACTIVE`** — with SSO on, company
   credentials live in Keycloak. (Admins: to migrate a user, reset their
   journey through the realm, or switch the platform back to local.)

## Role mapping matrix

| Keycloak realm/client role | ProvaHR role (`req.user.role`) |
|---|---|
| `ADMIN` | `ADMIN` |
| `RECRUITER` | `RECRUITER` |
| `INTERVIEWER` | `INTERVIEWER` |
| *(anything else, e.g. `offline_access`, `default-roles-…`)* | — |

Rules (implemented by `mapRoles` in `apps/api/src/lib/roles.ts`):

- Roles are read from the union of `realm_access.roles` and
  `resource_access[audience].roles` (client roles).
- Precedence: **ADMIN > RECRUITER > INTERVIEWER**. A token with both
  RECRUITER and INTERVIEWER acts as RECRUITER.
- A token with **none** of the three roles is rejected with
  **403 `FORBIDDEN`** ("Token has no ProvaHR role") — authenticated but
  authorized to do nothing. (`SUPER_ADMIN` is never granted by tokens — it is
  a platform-level local account.)
- While OIDC is enabled, Keycloak is the source of truth: the mapped role is
  written back to `user.role` on every request. Change the role (or remove all
  roles) in Keycloak and the next request follows.
- `requireRole(...)` gates company routes and simply never admits
  `SUPER_ADMIN`; `requireSuperAdmin` (in `modules/platform/`) gates platform
  routes. A company-less row of a company role is inert (401) — that is how
  company-scoped routes stay company-scoped with zero per-service edits.

## Connect your organization's Azure AD

High-level steps for an IT administrator (this is per **company realm** since
V2-3 — each tenant's admin configures their own realm and points
`issuerUrl` at it):

1. Run Keycloak (the compose stack ships one at `:8081`; a company may host
   its own) and sign in to its admin console → create/select the company's
   realm.
2. **Identity Brokering → Add provider → OpenID Connect** (this is what
   Azure AD / Microsoft Entra ID speaks). Fill in your Azure tenant's
   endpoints and an app registration's client id/secret; register Keycloak's
   redirect URI back in Azure.
3. Assign the ProvaHR realm roles (`ADMIN` / `RECRUITER` / `INTERVIEWER`) to
   the federated users or groups (per user, or via the broker's mappers).
4. In ProvaHR, the company ADMIN saves **Admin → Auth**: issuer URL = the
   realm's issuer (Keycloak reports it as `iss`), audience = the client id
   (add an audience mapper so access tokens carry it — the shipped
   `deploy/keycloak/provahr-realm.json` shows the pattern).
5. The platform super admin switches the install to SSO (**Platform →
   Settings**) — effective immediately. Users then sign in through their
   realm (or "Sign in with Microsoft" via the broker); ProvaHR never sees the
   corporate password.

SAML, LDAP and Google federation follow the same pattern — add the provider
under Identity Brokering (or User Federation for LDAP), assign ProvaHR realm
roles, done. ProvaHR itself only ever talks to Keycloak, so no code or config
in ProvaHR changes when you add or swap providers.

## Token verification contract

- **RS256 only.** Any other `alg` (HS256, `none`, ...) is rejected before key
  lookup — no algorithm-confusion games.
- **Issuer** must equal the selected config's `issuerUrl` (exact string) and
  **audience** must contain its `audience` (both enforced by `jwt.verify`).
- The signing key is resolved by `kid` from that issuer's JWKS:
  `${issuerUrl}/.well-known/openid-configuration` → its `jwks_uri`
  (falling back to `${issuerUrl}/.well-known/jwks.json` if discovery is
  unavailable).
- JWKS is **cached per issuer for 10 minutes** (one cache per configured
  realm, shared across requests). An unknown `kid` triggers exactly one
  throttled refresh and a retry — key rotation works with no restart, and
  has always worked this way.
- Required claims: non-empty `sub`, non-empty `email`. `name` falls back to
  `preferred_username`, then to `email`.
- Provisioning anchors the user to the matched config's company (env-default
  path: the first company); no company exists at all → **503
  `SETUP_REQUIRED`** (finish the platform bootstrap first).

## Environment variables (`apps/api/.env`) — fallbacks only

| Variable | Default | Meaning |
|---|---|---|
| `OIDC_ENABLED` | `false` | **Boot-time fallback** for the mode when no `PlatformSettings` row exists; the live mode is the portal setting |
| `OIDC_ISSUER_URL` | `http://localhost:8081/realms/provahr` | The **platform-default** issuer: verifies tokens whose `iss` matches no company config (trailing slashes stripped) |
| `OIDC_AUDIENCE` | `provahr-api` | The platform-default `aud` claim |

## Security notes

- **Local login is impossible for OIDC users.** Provisioned rows get a
  password hash of a random 32-byte hex string that nobody knows and that is
  not stored anywhere. Authentication happens at Keycloak or not at all.
  (Super admin aside — and in SSO mode even a *company* user's local token is
  refused with `SSO_MODE_ACTIVE`.)
- **Email is the join key in v1.** A verified token's `email` claim matches
  the local `user.email` (unique). An `externalId` column keyed on `sub` is
  planned so emails can change without breaking the link.
- **Instant lockout.** Removing all ProvaHR roles from a user in Keycloak (or
  disabling the account there) denies their next request; disabling the
  company's auth config (or the platform switching back to local) does the
  same for the whole tenant. Admins do not need to touch the ProvaHR
  database — and the super admin never needs Keycloak at all.
- **No restarts.** The mode switch, issuer configs, enabling/disabling — all
  are database rows read per request. The only auth-relevant restart
  condition left is rotating `JWT_SECRET` (local tokens) or the env fallback
  issuer.

## Testing

`apps/api/tests/oidc.test.ts` (18 tests, no network, no database — JWKS is
injected via `JwksCache`'s `jwksOverride` hook): token round-trips, the full
rejection matrix (wrong issuer/audience, expired, HS256, unknown `kid`,
missing claims), and role-mapping precedence.

`apps/api/tests/auth-multitenant.test.ts` (28 tests, V2-3) covers the
middleware against mocked prisma fixtures and per-issuer injected JWKS:
runtime mode resolution (row wins, env fallback, unreadable DB), multi-issuer
verification per company config, the super-admin local carve-out,
`SSO_MODE_ACTIVE` for company locals, unknown-issuer 401s, auth-config CRUD
scoping + `ISSUER_TAKEN`, and the 10s mode cache.

`apps/api/tests/platform-routes.test.ts` (18 tests, V2-1) covers the
super-admin gates: company CRUD with firstAdmin, settings switch, 401/403 for
non-super-admins. The local-mode path stays covered by `tests/app.test.ts`.

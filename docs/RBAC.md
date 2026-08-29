# RBAC & Authentication (D15)

ProvaHR ships a single `requireAuth` middleware with two interchangeable
modes. Applications stay identical in both modes — only *who verifies the
credential* changes.

## Overview

| | Local mode (dev default) | Keycloak mode (OIDC) |
|---|---|---|
| Credential | Email + password against the local Postgres user table | OIDC access token issued by the org's Keycloak realm |
| Token | HS256 JWT signed with `JWT_SECRET`, subject = user id | RS256 JWT signed by the issuer's private key |
| Verification | `JWT_SECRET` shared secret | Issuer's JWKS public keys (RS256, issuer + audience checked) |
| User row | Created by register/setup | Provisioned/synced from the verified token on every request |
| Roles | `user.role` column | Keycloak realm roles, mapped per request |
| Federation | None | Azure AD / SAML / LDAP / Google via Keycloak identity brokering |

### Environment variables (`apps/api/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `OIDC_ENABLED` | `false` | `false` = local mode, `true` = Keycloak mode |
| `OIDC_ISSUER_URL` | `http://localhost:8081/realms/provahr` | The issuer (`iss`) of accepted tokens; also where JWKS is discovered |
| `OIDC_AUDIENCE` | `provahr-api` | The `aud` claim required in access tokens |

### What changed in the middleware

`requireAuth` (in `apps/api/src/middleware/auth.ts`) is dual-mode:

- `OIDC_ENABLED=false` — unchanged local flow: Bearer token → HS256 verify →
  user loaded from Postgres → `req.user` attached. Deleted accounts stop
  working immediately.
- `OIDC_ENABLED=true` — Bearer token → `verifyOidcToken` (RS256 against the
  issuer's JWKS) → role mapped from token claims → local user row
  provisioned/synced → `req.user` attached in the same `AuthUser` shape.

`requireRole(...)` is identical in both modes: it inspects `req.user.role`,
which always holds one of `ADMIN | RECRUITER | INTERVIEWER`.

In Keycloak mode the request is rejected with **503 `SETUP_REQUIRED`** until
the install's company row exists (finish the `/setup` wizard first) — OIDC
users must belong to the single company.

## Role mapping matrix

| Keycloak realm role | ProvaHR role (`req.user.role`) |
|---|---|
| `ADMIN` | `ADMIN` |
| `RECRUITER` | `RECRUITER` |
| `INTERVIEWER` | `INTERVIEWER` |
| *(anything else, e.g. `offline_access`, `default-roles-provahr`)* | — |

Rules (implemented by `mapRoles` in `apps/api/src/lib/roles.ts`):

- Roles are read from the union of `realm_access.roles` and
  `resource_access[OIDC_AUDIENCE].roles` (client roles).
- Precedence: **ADMIN > RECRUITER > INTERVIEWER**. A token with both
  RECRUITER and INTERVIEWER acts as RECRUITER.
- A token with **none** of the three roles is rejected with
  **403 `FORBIDDEN`** ("Token has no ProvaHR role") — it is authenticated but
  authorized to do nothing.
- While OIDC is enabled, Keycloak is the source of truth: the mapped role is
  written back to `user.role` on every request. Change the role (or remove all
  roles) in Keycloak and the next request follows.

## Connect your organization's Azure AD

High-level steps for an IT administrator (detailed screenshots belong in the
future user guide):

1. Start Keycloak and sign in to the admin console
   (e.g. http://localhost:8081/admin) → select the **provahr** realm.
2. **Identity Brokering → Add provider → OpenID Connect** (this is what
   Azure AD / Microsoft Entra ID speaks).
3. Fill in your Azure tenant's authorization/token endpoints and the client
   ID/secret of an app registration you create in Azure.
4. Keycloak shows a **redirect URI** — register it back in the Azure app
   registration's redirect URIs.
5. Assign the ProvaHR realm roles (`ADMIN` / `RECRUITER` / `INTERVIEWER`) to
   the federated users or groups — per user, or better, via a group/role
   mapping in the broker's mappers.
6. Users then click "Sign in with Microsoft" (the broker) and authenticate
   with corporate credentials; ProvaHR never sees the corporate password.

SAML, LDAP and Google federation follow the same pattern — add the provider
under Identity Brokering (or User Federation for LDAP), assign ProvaHR realm
roles, done. ProvaHR itself only ever talks to Keycloak, so no code or config
in ProvaHR changes when you add or swap providers.

## Token verification contract

- **RS256 only.** Any other `alg` (HS256, `none`, ...) is rejected before key
  lookup — no algorithm-confusion games.
- **Issuer** must equal `OIDC_ISSUER_URL` and **audience** must contain
  `OIDC_AUDIENCE` (both enforced by `jwt.verify`).
- The signing key is resolved by `kid` from the issuer's JWKS:
  `${OIDC_ISSUER_URL}/.well-known/openid-configuration` → its `jwks_uri`
  (falling back to `${OIDC_ISSUER_URL}/.well-known/jwks.json` if discovery is
  unavailable).
- JWKS is **cached for 10 minutes**. An unknown `kid` triggers exactly one
  refresh and a retry — this is what makes key rotation work without
  restarting the API.
- Required claims: non-empty `sub`, non-empty `email`. `name` falls back to
  `preferred_username`, then to `email`.

## Security notes

- **Local login is impossible for OIDC users.** Provisioned rows get a
  password hash of a random 32-byte hex string that nobody knows and that is
  not stored anywhere. Authentication happens at Keycloak or not at all.
- **Email is the join key in v1.** A verified token's `email` claim matches
  the local `user.email` (unique). An `externalId` column keyed on `sub` is
  planned so emails can change without breaking the link.
- **Instant lockout.** Removing all ProvaHR roles from a user in Keycloak (or
  disabling the account there) denies their next request. Admins do not need
  to touch the ProvaHR database.
- **Single company per install.** Every provisioned user is attached to the
  one company row; multi-tenancy is out of scope for this decision.
- Local mode remains the dev default; it never performs network I/O for
  verification, and tests never need Keycloak or a database.

## Testing

`apps/api/tests/oidc.test.ts` (18 tests, no network, no database — JWKS is
injected via `JwksCache`'s `jwksOverride` hook):

- Token round-trip: `sub`/`email`/`name` extraction; `name` fallback chain;
  role union from `realm_access` + `resource_access[audience]` with dedup.
- Rejections: wrong issuer, wrong audience, expired token, HS256 token
  (stopped at the `alg` check), unknown `kid` after one refresh, missing
  `email`, missing `sub`, garbage input — each as a 401 `UNAUTHENTICATED`
  `AppError`.
- Role mapping precedence (ADMIN > RECRUITER > INTERVIEWER), single roles,
  empty → `null`, unrelated roles → `null`, duplicate/unrelated tolerance.

The middleware's local-mode path is covered by the pre-existing app tests
(`tests/app.test.ts`), which run with `OIDC_ENABLED=false` and must keep
passing unchanged.

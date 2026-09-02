# Keycloak for ProvaHR (OIDC mode)

This directory contains the ready-to-import Keycloak realm for ProvaHR's
Keycloak authentication mode (`OIDC_ENABLED=true` in `apps/api/.env`).

The realm provides:

- Realm **provahr** with the realm roles **ADMIN**, **RECRUITER**, **INTERVIEWER**.
- Client **provahr-api** — a bearer-only resource server (the API only verifies
  tokens; no secret flows exist for it).
- Client **provahr-web** — a public client for the frontend (authorization code
  flow + PKCE). It carries an audience mapper that adds `provahr-api` to the
  `aud` claim of issued access tokens, which the API requires.
- One bootstrap user **provahr-admin** (password `changeme-now`, realm role
  ADMIN).

## Run Keycloak with the realm import (development)

Requires Docker. Keycloak 26.x, development mode:

```bash
docker run --name provahr-keycloak \
  -p 8081:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  -e KC_HTTP_ENABLED=true \
  -v "$(pwd)/provahr-realm.json:/opt/keycloak/data/import/provahr-realm.json" \
  quay.io/keycloak/keycloak:26.0 start-dev --import-realm
```

Notes:

- On Windows PowerShell, replace `$(pwd)` with `${PWD}` (or use an absolute path).
- The bootstrap admin (`KC_BOOTSTRAP_ADMIN_*`) is the **Keycloak master
  console login**, not a ProvaHR login. Use it at
  http://localhost:8081/admin to manage the realm.
- `--import-realm` creates the `provahr` realm on first start. Realm files are
  only imported when the realm does not exist yet — to re-import from scratch,
  delete the container and its volume (or delete the realm in the console
  first).
- Keycloak is exposed on host port **8081** so it does not collide with the
  common dev port 8080.

Point the API at it (`apps/api/.env`):

```
OIDC_ENABLED=true
OIDC_ISSUER_URL=http://localhost:8081/realms/provahr
OIDC_AUDIENCE=provahr-api
```

Then a user who logs in to Keycloak (e.g. `provahr-admin` / `changeme-now`)
can call the API with `Authorization: Bearer <access-token>`.

## WARNING — bootstrap credentials

`provahr-admin` / `changeme-now` exists so a fresh install has a working
first login. In any shared or production environment you must either change
this user's password or delete the user entirely (via the Keycloak admin
console → provahr realm → Users). Same for the `KC_BOOTSTRAP_ADMIN_PASSWORD`.

## Federating a corporate IdP

The point of Keycloak mode is that organizations authenticate against their own
identity provider (Azure AD/Entra ID, SAML, LDAP, Google...) while ProvaHR only
ever talks to Keycloak. See `docs/RBAC.md` → "Connect your organization's
Azure AD" for the high-level steps.

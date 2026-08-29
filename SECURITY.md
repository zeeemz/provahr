# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| main / latest release | ✅ |
| older releases | ❌ |

## Reporting a vulnerability

We take the security of hiring data seriously. Candidate data handled by this
platform is sensitive personal data.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use **GitHub Security Advisories** ("Report a vulnerability" under the
Security tab of the repository). If that is not possible, email the maintainers
listed in the README.

Please include:

- Description of the issue and its impact
- Steps to reproduce (a PoC is ideal)
- Affected endpoints/files
- Suggested mitigation, if any

We aim to acknowledge reports within **72 hours** and will keep you informed
about remediation progress.

## Scope notes

- Vulnerabilities in unmodified dependencies should be reported upstream, but
  let us know too so we can bump versions.
- Self-hosters: make sure you run behind TLS (a reverse proxy such as Caddy or
  nginx) — the app server itself terminates plain HTTP.
- Default credentials created by the seed script are for development only and
  must never be used in production deployments.

## Hardening checklist for self-hosters

1. Set a strong `JWT_SECRET` (32+ random bytes) — do not ship `.env` to git.
2. Restrict `CORS_ORIGIN` to your frontend origin.
3. Put the API behind TLS.
4. Restrict database credentials and network exposure.
5. Set a strong `SECRETS_KEY` (used to encrypt LLM provider keys and sealed
   question pools at rest).
6. Keep Postgres and Node patched.

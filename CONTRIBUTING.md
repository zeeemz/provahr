# Contributing to ProvaHR

Thanks for your interest in contributing! This project thrives on contributors.

## Getting set up

This is an npm-workspaces monorepo. Install once at the root — workspaces link the
packages together — then work inside the app you're touching.

```bash
git clone https://github.com/YOUR_ORG/provahr.git
cd provahr
npm install                    # root install; workspaces link packages

# API (the tracking spine)
cd apps/api
cp .env.example .env           # point DATABASE_URL at your Postgres 16
npx prisma migrate deploy      # create schema
npm run seed                   # demo company, jobs, applications
npm run dev                    # → http://localhost:4000
```

Sign in with the seeded demo account `admin@acme.test` / `password123`.

## Before you open a PR

1. **For anything non-trivial, open an issue first** and agree on the approach.
   This saves everyone time.
2. **Branch from `main`**: `git checkout -b feat/short-description`.
3. **Keep PRs small** — one logical change per PR.
4. **Tests are required** for bug fixes and new business logic.
   Run the full check locally from the repo root:

   ```bash
   npm test                                  # all workspaces
   # or just the API:
   npm run test --workspace @provahr/api
   ```

5. **Update the docs with the code.** If your change alters behavior, URLs, data
   model, or setup — update the affected docs (see
   [`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md)) in the same PR. A change is
   not "done" until code + tests + docs are updated.
6. **Commits**: use short, imperative subjects (`Add rejection reason to stage API`).

## Code conventions

- TypeScript everywhere; no `any` unless there is no alternative (and say why).
- The apps and what's expected of them:

| App | Path | Conventions |
|---|---|---|
| api | `apps/api` | Thin route handlers — business rules live in services (`src/modules/*/service.ts`); every query is scoped by the caller's `companyId` (tenancy) |
| web | `apps/web` | HR console + candidate portal (planned) |
| worker | `apps/worker` | LLM + sandbox jobs (planned); job handlers must be idempotent |
| mobile | `apps/mobile` | Expo candidate app (planned) |
| shared | `packages/shared` | Types and contracts only — no runtime dependencies without discussion |

- Never trust client-supplied ids without checking ownership.
- Feature discussions and architecture decisions are captured in
  [`docs/PLAN.md`](docs/PLAN.md) — update it when your change alters the design.

## Fair-hiring commitments (important)

This software makes decisions about people's careers. When contributing:

- Never add automation that auto-rejects candidates without a human decision —
  AI flags suspicion; humans decide.
- Keep the audit trail (`StageEvent`) append-only.
- Collect only the candidate data the process actually needs (data minimization).
- Never expose sealed-pool contents through any user-facing route.
- Never add automated rejections.

## Reporting bugs

Open an issue with: what you did, what you expected, what happened, and how to
reproduce it (seed data helps). Include the browser/Node versions.

## Conduct

All interactions are covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the
[Apache-2.0 License](LICENSE).

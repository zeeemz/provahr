# syntax=docker/dockerfile:1
# ProvaHR API — monorepo-aware multi-stage build.
#
# The build context MUST be the repo root (the app is a npm workspace):
#   docker build -f apps/api/Dockerfile .
#
# NOTE: source files are COPYed by explicit path (src/, tsconfig*, prisma/)
# rather than `COPY apps/api .` — a repo-root context does not consult
# apps/api/.dockerignore, and explicit paths keep local node_modules/, dist/
# and .env out of the image unconditionally.

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /repo

# Manifests first, so the dependency layers cache independently of source edits.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace @provahr/api

# Prisma client generation only needs the schema.
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Now the sources. Shared is built first because the API will import it in
# later phases (today it does not — building it anyway keeps this correct).
COPY packages/shared ./packages/shared
COPY apps/api/src ./apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.build.json ./apps/api/
RUN npm run build --workspace @provahr/shared \
 && npm run build --workspace @provahr/api

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# docker-cli for the sandbox executor (E2E catch: the worker spawns
# `docker run` for candidate code — containerized, it needs the CLI; the
# daemon itself is the HOST's, reached via the socket mount in compose).
RUN apk add --no-cache docker-cli

# Same manifests, production dependencies only.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN npm ci --workspace @provahr/api --omit=dev

# The prisma CLI is a devDependency of the API, but this container runs
# `npx prisma migrate deploy` / `prisma db push` at startup (see
# docker-compose.yml). Install the CLI at the version the API itself declares,
# so npx never fetches a mismatched major from the network at boot.
RUN npm install --no-save "prisma@$(node -p "require('./apps/api/package.json').devDependencies.prisma")"

# Schema + migrations: needed by prisma at startup and by generate below.
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Built output. @provahr/shared is symlinked into node_modules by npm ci, so
# copy the built shared workspace too (unused today, future phases need it).
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/packages/shared ./packages/shared

EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]

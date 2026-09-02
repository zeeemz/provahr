#!/usr/bin/env bash
# ProvaHR installer — prerequisites, dependencies, .env, database schema.
#
# Usage:
#   scripts/install.sh            # install + prepare database schema
#   scripts/install.sh --seed     # ... and seed demo data afterwards
#
# Requires bash (Git Bash on Windows, or bash on Linux/macOS) — uses
# `pipefail`, which plain POSIX sh/dash does not support.
set -euo pipefail

# Resolve the repo root from this script's location.
cd "$(dirname "$0")/.."

# --- Parse arguments --------------------------------------------------------
SEED=0
for arg in "$@"; do
  case "$arg" in
    --seed) SEED=1 ;;
    *)
      echo "ERROR: unknown option: $arg" >&2
      echo "Usage: scripts/install.sh [--seed]" >&2
      exit 1
      ;;
  esac
done

# --- Prerequisites ----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js was not found on PATH." >&2
  echo "       Install Node 20 or newer from https://nodejs.org and re-run." >&2
  exit 1
fi

NODE_VERSION="$(node -p process.versions.node)"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node v${NODE_VERSION} found, but ProvaHR requires Node >= 20." >&2
  echo "       Upgrade from https://nodejs.org and re-run." >&2
  exit 1
fi

echo "=== Detected versions ==="
echo "node  v${NODE_VERSION}"
echo "npm   v$(npm --version)"
if command -v docker >/dev/null 2>&1; then
  echo "docker $(docker --version)"
else
  echo "docker not found - start PostgreSQL manually (or install Docker and run: docker compose up -d db)"
fi
echo

# --- Dependencies (npm workspaces install from the repo root) ---------------
echo "=== Installing dependencies (npm workspaces) ==="
npm install
echo

# --- API environment file + database schema ----------------------------------
cd apps/api

if [ ! -f .env ]; then
  cp .env.example .env
  echo "created .env - defaults target localhost Postgres"
fi

echo "=== Generating the Prisma client ==="
npx prisma generate

echo "=== Applying the database schema ==="
if ls prisma/migrations/*/migration.sql >/dev/null 2>&1; then
  echo "Applying committed migrations (prisma migrate deploy)..."
  npx prisma migrate deploy
else
  # No migrations have been committed to the repo yet. `prisma migrate deploy`
  # hard-fails in that state ("No migration found in prisma/migrations"), so
  # create the schema straight from schema.prisma instead. This branch turns
  # itself off once migrations land.
  echo "NOTE: no committed migrations under apps/api/prisma/migrations yet."
  echo "      Creating the schema directly from schema.prisma (prisma db push)."
  npx prisma db push
fi

if [ "$SEED" -eq 1 ]; then
  echo "=== Seeding demo data (--seed) ==="
  npm run seed
fi

cd ../..

# --- Done --------------------------------------------------------------------
echo
echo "============================================================"
echo " ProvaHR install complete"
echo "============================================================"
echo "Next steps:"
echo "  1. Start the API:"
echo "       npm run dev:api        (from the repo root)"
echo "  2. Open the setup wizard in a browser:"
echo "       http://localhost:4000/setup"
echo "     It creates your company + first admin, then locks itself."
echo "  3. Pointers: README.md, docs/PLAN.md, docs/RBAC.md"
echo "============================================================"

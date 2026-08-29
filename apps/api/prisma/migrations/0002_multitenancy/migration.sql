-- 0002_multitenancy — V2-1 multi-tenant core (PLAN.md §12 D18/D19, §12.1).
-- Generated offline via:
--   npx prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script --shadow-database-url <scratch>
-- (statements below the CreateTable are hand-appended: the singleton seed and
-- the drop of 0001's migration-managed single-company index).

-- AlterEnum
-- Platform-level role (D18): super admins own the install, not a company.
-- PostgreSQL 12+ allows ADD VALUE inside the migration transaction because no
-- statement below *uses* the new value.
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
-- Super admins carry no company (D18); existing company users are unaffected.
ALTER TABLE "users" ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "authMode" TEXT NOT NULL DEFAULT 'local',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton row so GET /api/auth/mode and the platform console read
-- DATA from the first boot after migrate deploy (D19). Idempotent: re-runs and
-- restored databases keep any existing value. Databases built via `db push`
-- skip migrations entirely — the service layer upserts the row on first write.
INSERT INTO "platform_settings" ("id", "authMode", "updatedAt")
VALUES ('singleton', 'local', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- DropIndex
-- 0001's migration-managed single-company invariant (QA wave-1 F2) is
-- superseded by D18: companies are tenants now, created by the super admin
-- through POST /api/platform/companies.
DROP INDEX "companies_singleton_idx";

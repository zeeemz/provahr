-- 0003_tenant_llm — V2-2 company-scoped LLM providers (PLAN.md §12 D20).
-- Generated offline via:
--   npx prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script \
--     --shadow-database-url postgresql://…/provahr_shadow_tmp
-- (the two statements below the AddForeignKey are hand-appended, like
-- 0002's singleton seed: prisma cannot express partial unique indexes.)
--
-- Nullable ON PURPOSE (D20 rollout): pre-V2.2 installs have at most a couple
-- of provider rows with no company; they keep companyId NULL and are unusable
-- legacy — every read path filters companyId = <caller's company>, which a
-- NULL row never matches. V2-3's hardening backfills a real company (or
-- deletes the rows) and makes the column required.

-- AlterTable
ALTER TABLE "llm_providers" ADD COLUMN     "companyId" TEXT;

-- CreateIndex
CREATE INDEX "llm_providers_companyId_idx" ON "llm_providers"("companyId");

-- AddForeignKey
ALTER TABLE "llm_providers" ADD CONSTRAINT "llm_providers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropIndex + CreateIndex (hand-appended)
-- 0001's single-ACTIVE invariant was GLOBAL (one active provider per
-- install): ON ((true)) WHERE "isActive". Under D20 each company owns its
-- providers, so the invariant becomes one active provider PER COMPANY. The
-- service-level deactivate-then-activate transaction is company-scoped since
-- this wave; this index swap closes the DB-level gap — without it, the second
-- company to activate a provider would die on a unique violation. NULL
-- companyIds stay distinct under Postgres default NULLS DISTINCT, which is
-- the desired "legacy rows are inert" behavior.
DROP INDEX "llm_providers_single_active_idx";
CREATE UNIQUE INDEX "llm_providers_single_active_idx" ON "llm_providers"("companyId") WHERE "isActive";

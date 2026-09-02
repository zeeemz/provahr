-- 0006_two_tier_prompts — two-tier system prompts (founder requirement):
-- one MAIN, platform-wide prompt (PlatformSettings.mainPrompt — editable only
-- by the super admin) plus a JOB-SPECIFIC prompt per role (Job.jobPrompt —
-- editable by the HR user creating that job). Both are readable by company
-- users; both are appended, in that order, ahead of the hardcoded base system
-- prompt on every LLM call (src/prompts/compose.ts composeSystem). Generated
-- offline via:
--   npx prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script \
--     --shadow-database-url postgresql://…/provahr_shadow_tmp
-- (nothing hand-appended: both changes are plain Prisma-schema-expressible
-- column adds, like 0005.)
--
-- No data migration: '' / NULL both mean "no overlay", and composeSystem
-- skips empty sections — every existing install behaves byte-for-byte as
-- before until somebody saves a prompt through the portal.

-- AlterTable
ALTER TABLE "platform_settings" ADD COLUMN     "mainPrompt" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "jobPrompt" TEXT;

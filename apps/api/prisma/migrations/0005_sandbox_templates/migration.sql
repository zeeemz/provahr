-- 0005_sandbox_templates — V2-4 company-scoped sandbox image templates
-- (PLAN.md §12 D21, §12.1 V2-4). Generated offline via:
--   npx prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script \
--     --shadow-database-url postgresql://…/provahr_shadow_tmp
-- (nothing hand-appended this time: the @@unique([companyId, language]) and
-- @@index([companyId]) constraints are plain Prisma-schema-expressible
-- indexes, unlike 0001/0003/0004's partial unique indexes.)
--
-- No data migration: the table starts EMPTY, so every company resolves every
-- language to the platform default (IMAGE_ALLOW_LIST) exactly as before —
-- templates only override once a company admin saves one through the portal.

-- CreateTable
CREATE TABLE "sandbox_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "language" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sandbox_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sandbox_templates_companyId_language_key" ON "sandbox_templates"("companyId", "language");

-- CreateIndex
CREATE INDEX "sandbox_templates_companyId_idx" ON "sandbox_templates"("companyId");

-- AddForeignKey
ALTER TABLE "sandbox_templates" ADD CONSTRAINT "sandbox_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

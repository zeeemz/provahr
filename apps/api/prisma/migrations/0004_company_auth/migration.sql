-- 0004_company_auth — V2-3 runtime per-company Keycloak/OIDC config
-- (PLAN.md §12 D19, §12.1). Generated offline via:
--   npx prisma migrate diff --from-migrations prisma/migrations \
--     --to-schema-datamodel prisma/schema.prisma --script \
--     --shadow-database-url postgresql://…/provahr_shadow_tmp
-- (the statement below the AddForeignKey is hand-appended, like 0002's seed
-- and 0003's index swap: prisma cannot express partial unique indexes.)
--
-- No data migration: `enabled` defaults to FALSE, so the table starts empty of
-- authority — every install keeps authenticating exactly as it did until a
-- company admin saves AND enables a config through the portal.

-- CreateTable
CREATE TABLE "company_auth_configs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "issuerUrl" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_auth_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_auth_configs_companyId_key" ON "company_auth_configs"("companyId");

-- AddForeignKey
ALTER TABLE "company_auth_configs" ADD CONSTRAINT "company_auth_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (hand-appended)
-- One ENABLED config per issuer (the middleware resolves `iss` → ONE company;
-- two enabled rows for the same issuer would make that ambiguous). Disabled
-- draft rows are unconstrained — companies may stage the same issuer they
-- plan to move to. Same drift-risk caveat as 0001/0003's partial indexes:
-- `db push` databases never materialize it; the admin service's pre-check
-- remains the functional guard.
CREATE UNIQUE INDEX "company_auth_configs_enabled_issuer_key" ON "company_auth_configs"("issuerUrl") WHERE "enabled";

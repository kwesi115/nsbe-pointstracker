-- Hand-written migration (see prisma/migrations/0001_init/migration.sql header
-- for why: the schema-engine binary is blocked on this machine). Follows the
-- same naming convention.
--
-- Multi-tenancy: introduces Org and scopes User/Event/PointSystem/Config/
-- AdminLog/UploadedFile to it. Since this DB has only ever held one chapter's
-- data, every existing row is backfilled to a single seeded Org
-- ("howard-nsbe") in the same transaction that adds the NOT NULL constraint —
-- there is no window where orgId is null on a live row.
--
-- Also: JoinCode (role-scoped signup codes), Role gains ADMIN, User gains
-- phone/personalEmail/tshirtSize, passwordHash becomes nullable (a GUEST row
-- has none at all — see lib/auth.ts), and the email-verification-token
-- columns are dropped (JoinCode replaces that whole signup-gating mechanism).

-- CreateEnum
CREATE TYPE "ShirtSize" AS ENUM ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL');

-- AlterEnum (not used elsewhere in this file/transaction, so the PG12+
-- same-transaction restriction on newly added enum values doesn't apply here)
ALTER TYPE "Role" ADD VALUE 'ADMIN';

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Org_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Org_slug_key" ON "Org"("slug");

-- Seed the one chapter every existing row backfills onto. id and slug match
-- deliberately so this row is trivially re-upsertable from prisma/seed.ts.
INSERT INTO "Org" ("id", "slug", "name", "shortName", "active", "createdAt")
VALUES ('howard-nsbe', 'howard-nsbe', 'Howard University NSBE', 'Howard NSBE', true, CURRENT_TIMESTAMP);

-- CreateTable
CREATE TABLE "JoinCode" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "grantsRole" "Role" NOT NULL,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    CONSTRAINT "JoinCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JoinCode_orgId_active_idx" ON "JoinCode"("orgId", "active");
ALTER TABLE "JoinCode" ADD CONSTRAINT "JoinCode_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: User
ALTER TABLE "User" ADD COLUMN "orgId" TEXT;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "personalEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "tshirtSize" "ShirtSize";
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" DROP COLUMN "emailVerifiedAt";
ALTER TABLE "User" DROP COLUMN "verificationToken";
ALTER TABLE "User" DROP COLUMN "verificationExpiresAt";

UPDATE "User" SET "orgId" = 'howard-nsbe';
ALTER TABLE "User" ALTER COLUMN "orgId" SET NOT NULL;

DROP INDEX "User_email_key";
CREATE UNIQUE INDEX "User_orgId_email_key" ON "User"("orgId", "email");
CREATE INDEX "User_orgId_idx" ON "User"("orgId");
ALTER TABLE "User" ADD CONSTRAINT "User_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "JoinCode" ADD CONSTRAINT "JoinCode_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: Event
ALTER TABLE "Event" ADD COLUMN "orgId" TEXT;
UPDATE "Event" SET "orgId" = 'howard-nsbe';
ALTER TABLE "Event" ALTER COLUMN "orgId" SET NOT NULL;

DROP INDEX "Event_slug_key";
CREATE UNIQUE INDEX "Event_orgId_slug_key" ON "Event"("orgId", "slug");
CREATE INDEX "Event_orgId_idx" ON "Event"("orgId");
ALTER TABLE "Event" ADD CONSTRAINT "Event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: PointSystem
ALTER TABLE "PointSystem" ADD COLUMN "orgId" TEXT;
UPDATE "PointSystem" SET "orgId" = 'howard-nsbe';
ALTER TABLE "PointSystem" ALTER COLUMN "orgId" SET NOT NULL;

DROP INDEX "PointSystem_eventType_key";
CREATE UNIQUE INDEX "PointSystem_orgId_eventType_key" ON "PointSystem"("orgId", "eventType");
CREATE INDEX "PointSystem_orgId_idx" ON "PointSystem"("orgId");
ALTER TABLE "PointSystem" ADD CONSTRAINT "PointSystem_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: Config — key was the primary key; it becomes a plain column,
-- unique per-org instead of globally. Reusing the old key value as the new id
-- is safe: every existing key was already globally unique, so it's trivially
-- unique as a cuid-shaped-but-not-cuid id too, and this is a one-time backfill
-- for rows that already exist, not a naming convention going forward.
ALTER TABLE "Config" ADD COLUMN "id" TEXT;
ALTER TABLE "Config" ADD COLUMN "orgId" TEXT;
UPDATE "Config" SET "id" = "key", "orgId" = 'howard-nsbe';
ALTER TABLE "Config" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Config" ALTER COLUMN "orgId" SET NOT NULL;
ALTER TABLE "Config" DROP CONSTRAINT "Config_pkey";
ALTER TABLE "Config" ADD CONSTRAINT "Config_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "Config_orgId_key_key" ON "Config"("orgId", "key");
CREATE INDEX "Config_orgId_idx" ON "Config"("orgId");
ALTER TABLE "Config" ADD CONSTRAINT "Config_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Config keys JoinCode replaces entirely (Part 8) — no longer meaningful once
-- role/signup gating comes from JoinCode rows instead.
DELETE FROM "Config" WHERE "key" IN ('CHAPTER_JOIN_CODE', 'CHAPTER_JOIN_CODE_ROTATED_AT', 'SIGNUP_MODE');

-- AlterTable: AdminLog
ALTER TABLE "AdminLog" ADD COLUMN "orgId" TEXT;
UPDATE "AdminLog" SET "orgId" = 'howard-nsbe';
ALTER TABLE "AdminLog" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "AdminLog_orgId_idx" ON "AdminLog"("orgId");
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable: UploadedFile
ALTER TABLE "UploadedFile" ADD COLUMN "orgId" TEXT;
UPDATE "UploadedFile" SET "orgId" = 'howard-nsbe';
ALTER TABLE "UploadedFile" ALTER COLUMN "orgId" SET NOT NULL;
CREATE INDEX "UploadedFile_orgId_idx" ON "UploadedFile"("orgId");
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

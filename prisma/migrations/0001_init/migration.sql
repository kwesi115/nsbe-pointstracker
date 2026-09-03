-- Hand-written initial migration.
--
-- Prisma's schema-engine binary (used by `prisma migrate dev`/`db push`) is
-- blocked by this machine's Windows Application Control policy, so this
-- migration was written by hand instead of generated, and applied directly
-- via scripts/db-apply-sql.ts (plain `pg`) rather than the Prisma CLI.
--
-- Table, column, constraint, and index names below deliberately follow
-- Prisma's default naming convention (<Table>_pkey, <Table>_<col>_key,
-- <Table>_<col>_fkey, <Table>_<cols>_idx) so Prisma Client's error mapping
-- (e.g. P2002 -> which unique constraint fired) behaves exactly as it would
-- had `prisma migrate dev` generated this file. Keep that convention for any
-- future hand-written migration on this machine.

CREATE TYPE "Role" AS ENUM ('GENERAL', 'EBOARD', 'GUEST');
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'CANCELED');
CREATE TYPE "CodeMode" AS ENUM ('NONE', 'STATIC', 'ROTATING');
CREATE TYPE "FieldType" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SELECT', 'MULTI_SELECT', 'NUMBER', 'YES_NO', 'RATING', 'DATE');
CREATE TYPE "RegistrationSource" AS ENUM ('FORM', 'MANUAL');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "studentId" TEXT,
    "classification" TEXT,
    "major" TEXT,
    "membership" TEXT,
    "house" TEXT,
    "role" "Role" NOT NULL DEFAULT 'GENERAL',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "emailVerifiedAt" TIMESTAMP(3),
    "verificationToken" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_status_idx" ON "User"("status");

CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "pointsOverride" INTEGER,
    "checkInCode" TEXT,
    "codeMode" "CodeMode" NOT NULL DEFAULT 'STATIC',
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "durationMinutes" INTEGER NOT NULL DEFAULT 20,
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3),
    "reopenNote" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");
CREATE INDEX "Event_status_opensAt_closesAt_idx" ON "Event"("status", "opensAt", "closesAt");
ALTER TABLE "Event" ADD CONSTRAINT "Event_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "FormField" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "FieldType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "options" TEXT[],
    "helpText" TEXT,
    "order" INTEGER NOT NULL,
    "prefill" TEXT,
    CONSTRAINT "FormField_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FormField_eventId_fieldKey_key" ON "FormField"("eventId", "fieldKey");
ALTER TABLE "FormField" ADD CONSTRAINT "FormField_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "roleAtTime" "Role" NOT NULL,
    "source" "RegistrationSource" NOT NULL DEFAULT 'FORM',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Registration_eventId_userId_key" ON "Registration"("eventId", "userId");
CREATE INDEX "Registration_userId_idx" ON "Registration"("userId");
CREATE INDEX "Registration_eventId_idx" ON "Registration"("eventId");
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Answer" (
    "id" TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Answer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Answer_registrationId_fieldKey_key" ON "Answer"("registrationId", "fieldKey");
ALTER TABLE "Answer" ADD CONSTRAINT "Answer_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "Registration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PointSystem" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    CONSTRAINT "PointSystem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PointSystem_eventType_key" ON "PointSystem"("eventType");

CREATE TABLE "Config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Config_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AdminLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdminLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminLog_createdAt_idx" ON "AdminLog"("createdAt");
ALTER TABLE "AdminLog" ADD CONSTRAINT "AdminLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

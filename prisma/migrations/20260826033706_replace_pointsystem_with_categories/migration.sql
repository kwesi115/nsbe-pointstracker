/*
  Warnings:

  - You are about to drop the column `countsForEboard` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Event` table. All the data in the column will be lost.
  - You are about to drop the `PointSystem` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `categoryId` to the `Event` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "GroupKind" AS ENUM ('NSBE_WEEK');

-- CreateEnum
CREATE TYPE "AwardKind" AS ENUM ('GAME_COMPETITION', 'MONTHLY_CHAMPION', 'MANUAL');

-- DropForeignKey
ALTER TABLE "PointSystem" DROP CONSTRAINT "PointSystem_orgId_fkey";

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "countsForEboard",
DROP COLUMN "type",
ADD COLUMN     "categoryId" TEXT NOT NULL,
ADD COLUMN     "groupId" TEXT;

-- DropTable
DROP TABLE "PointSystem";

-- CreateTable
CREATE TABLE "EventCategory" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "tier" INTEGER,
    "memberPoints" INTEGER NOT NULL,
    "examples" TEXT,
    "countsForMonthly" BOOLEAN NOT NULL DEFAULT true,
    "eboardEligible" BOOLEAN NOT NULL DEFAULT true,
    "audience" "Audience" NOT NULL DEFAULT 'ALL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventGroup" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "GroupKind" NOT NULL,
    "expectedEventCount" INTEGER NOT NULL DEFAULT 5,
    "bonusTiers" JSONB NOT NULL,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointAward" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "AwardKind" NOT NULL,
    "points" INTEGER NOT NULL,
    "eventId" TEXT,
    "periodMonth" TEXT,
    "reason" TEXT NOT NULL,
    "awardedById" TEXT,
    "awardedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeNote" TEXT,

    CONSTRAINT "PointAward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventCategory_orgId_idx" ON "EventCategory"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EventCategory_orgId_code_key" ON "EventCategory"("orgId", "code");

-- CreateIndex
CREATE INDEX "EventGroup_orgId_idx" ON "EventGroup"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EventGroup_orgId_slug_key" ON "EventGroup"("orgId", "slug");

-- CreateIndex
CREATE INDEX "PointAward_orgId_userId_idx" ON "PointAward"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PointAward_orgId_userId_kind_eventId_key" ON "PointAward"("orgId", "userId", "kind", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PointAward_orgId_userId_kind_periodMonth_key" ON "PointAward"("orgId", "userId", "kind", "periodMonth");

-- CreateIndex
CREATE INDEX "Event_categoryId_idx" ON "Event"("categoryId");

-- CreateIndex
CREATE INDEX "Event_groupId_idx" ON "Event"("groupId");

-- AddForeignKey
ALTER TABLE "EventCategory" ADD CONSTRAINT "EventCategory_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGroup" ADD CONSTRAINT "EventGroup_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventGroup" ADD CONSTRAINT "EventGroup_finalizedById_fkey" FOREIGN KEY ("finalizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "EventCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EventGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

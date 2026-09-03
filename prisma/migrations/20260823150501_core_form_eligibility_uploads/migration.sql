-- CreateEnum
CREATE TYPE "Classification" AS ENUM ('FRESHMAN', 'SOPHOMORE', 'JUNIOR', 'SENIOR', 'GRADUATE');

-- CreateEnum
CREATE TYPE "FileKind" AS ENUM ('RESUME', 'HOUSE_PROOF');

-- AlterTable
ALTER TABLE "Event" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Registration" ADD COLUMN     "classificationAtTime" "Classification",
ADD COLUMN     "coreFormVersion" INTEGER,
ADD COLUMN     "duesReportedAtTime" BOOLEAN,
ADD COLUMN     "eligibleAtTime" BOOLEAN,
ADD COLUMN     "majorAtTime" TEXT,
ADD COLUMN     "nationalReportedAtTime" BOOLEAN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "duesPaidReported" BOOLEAN,
ADD COLUMN     "duesReportedAt" TIMESTAMP(3),
ADD COLUMN     "duesVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "duesVerifiedById" TEXT,
ADD COLUMN     "houseProofFileId" TEXT,
ADD COLUMN     "houseVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "houseVerifiedById" TEXT,
ADD COLUMN     "majorOther" TEXT,
ADD COLUMN     "nationalMemberReported" BOOLEAN,
ADD COLUMN     "nationalVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "nationalVerifiedById" TEXT,
ADD COLUMN     "nsbeMembershipId" TEXT,
ADD COLUMN     "resumeConsentAt" TIMESTAMP(3),
ADD COLUMN     "resumeFileId" TEXT,
ADD COLUMN     "resumeUpdatedAt" TIMESTAMP(3),
DROP COLUMN "classification",
ADD COLUMN     "classification" "Classification",
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "UploadedFile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "FileKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadedFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UploadedFile_userId_kind_idx" ON "UploadedFile"("userId", "kind");

-- CreateIndex
CREATE INDEX "User_duesVerifiedAt_idx" ON "User"("duesVerifiedAt");

-- CreateIndex
CREATE INDEX "User_nationalVerifiedAt_idx" ON "User"("nationalVerifiedAt");

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


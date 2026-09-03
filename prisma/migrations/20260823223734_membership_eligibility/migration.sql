
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "duesRevokedAt" TIMESTAMP(3),
ADD COLUMN     "duesRevokedById" TEXT,
ADD COLUMN     "duesRevokedNote" TEXT,
ADD COLUMN     "membershipSeason" TEXT,
ADD COLUMN     "nationalRevokedAt" TIMESTAMP(3),
ADD COLUMN     "nationalRevokedById" TEXT,
ADD COLUMN     "nationalRevokedNote" TEXT;


-- CreateEnum
CREATE TYPE "Audience" AS ENUM ('ALL', 'EBOARD_ONLY');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "audience" "Audience" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "countsForEboard" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "eboardPosition" TEXT;


-- AlterTable
ALTER TABLE "Event" DROP COLUMN "checkInCode",
DROP COLUMN "codeMode",
ALTER COLUMN "durationMinutes" SET DEFAULT 15;

-- DropEnum
DROP TYPE "CodeMode";


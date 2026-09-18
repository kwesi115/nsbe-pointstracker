-- AlterEnum
ALTER TYPE "AwardKind" ADD VALUE 'ADJUSTMENT';

-- AlterEnum
ALTER TYPE "Permission" ADD VALUE 'POINTS_WRITE';

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "permanentDeleteAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PointAward" ADD COLUMN     "relatedEventId" TEXT,
ADD COLUMN     "season" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "permanentDeleteAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Event_orgId_permanentDeleteAt_idx" ON "Event"("orgId", "permanentDeleteAt");

-- CreateIndex
CREATE INDEX "PointAward_orgId_kind_season_idx" ON "PointAward"("orgId", "kind", "season");

-- CreateIndex
CREATE INDEX "User_orgId_permanentDeleteAt_idx" ON "User"("orgId", "permanentDeleteAt");

-- AddForeignKey
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_relatedEventId_fkey" FOREIGN KEY ("relatedEventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written below this line. Prisma's schema language has no CHECK
-- constraints, so these live only here — same precedent as
-- User_single_credential_check (20260914200000_setup_code_column).
--
-- The enum comparisons cast "kind" to text on purpose: 'ADJUSTMENT' was added
-- to AwardKind above, in this same transaction, and Postgres refuses to use a
-- freshly added enum value as a literal before that transaction commits.
-- ---------------------------------------------------------------------------

-- An adjustment has to say why (10+ characters — "correction" is not a
-- reason) and which season it belongs to, so a rollover drops it.
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_adjustment_fields_check"
  CHECK ("kind"::text <> 'ADJUSTMENT' OR ("season" IS NOT NULL AND char_length(btrim("reason")) >= 10));

-- Only an adjustment may take points away. NOT VALID: enforced for every row
-- written from now on without refusing to deploy over a historical negative
-- MANUAL award, should one exist.
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_points_sign_check"
  CHECK ("kind"::text = 'ADJUSTMENT' OR "points" >= 0) NOT VALID;

-- relatedEventId is the adjustment's own event link (eventId belongs to the
-- GAME_COMPETITION cap).
ALTER TABLE "PointAward" ADD CONSTRAINT "PointAward_related_event_check"
  CHECK ("relatedEventId" IS NULL OR "kind"::text = 'ADJUSTMENT');

-- A trashed row always has an expiry, and a live row never does — the sweep
-- (lib/repo.ts runTrashSweep) selects on permanentDeleteAt alone.
ALTER TABLE "User" ADD CONSTRAINT "User_trash_fields_check"
  CHECK (("deletedAt" IS NULL) = ("permanentDeleteAt" IS NULL));

ALTER TABLE "Event" ADD CONSTRAINT "Event_trash_fields_check"
  CHECK (("deletedAt" IS NULL) = ("permanentDeleteAt" IS NULL));

-- One-shot claim tickets for admin actions that must not run twice
-- (see prisma/schema.prisma model RequestClaim, lib/repo.ts claimRequestToken).
--
-- The unique index is the point of the table: resetPassword and
-- rotateJoinCodeById insert the client's requestToken in the same transaction
-- as the credential they generate, so a second concurrent submission blocks on
-- the index, fails, and rolls its own work back. Without it, "the button was
-- disabled" is the only thing standing between an impatient admin on a slow
-- connection and two setup codes, only the second of which works.
CREATE TABLE IF NOT EXISTS "RequestClaim" (
    "id"        TEXT NOT NULL,
    "orgId"     TEXT NOT NULL,
    "scope"     TEXT NOT NULL,
    "token"     TEXT NOT NULL,
    "target"    TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestClaim_orgId_scope_token_key"
    ON "RequestClaim" ("orgId", "scope", "token");

CREATE INDEX IF NOT EXISTS "RequestClaim_createdAt_idx"
    ON "RequestClaim" ("createdAt");

ALTER TABLE "RequestClaim"
    ADD CONSTRAINT "RequestClaim_orgId_fkey" FOREIGN KEY ("orgId")
    REFERENCES "Org" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

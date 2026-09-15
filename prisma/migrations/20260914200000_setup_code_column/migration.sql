-- Setup codes get their own column (see prisma/schema.prisma model User and
-- lib/setup-code.ts).
--
-- Before this, a setup code was bcrypt-hashed straight into passwordHash, so
-- it could never be shown again ("Resend code" was impossible) and a pending
-- account looked exactly like one with a real password. Now a pending account
-- holds EXACTLY ONE credential: passwordHash NULL, setupCode set (sealed with
-- AES-256-GCM under CODE_SECRET — never plaintext). set-password clears it.
--
-- Additive only. Existing rows are untouched: an account still pending from
-- the old scheme (hash of a code, setupCode NULL) keeps signing in with that
-- code exactly as before (see lib/credentials.ts), and a reset moves it to the
-- new shape.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "setupCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "setupCodeIssuedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "setupCodeIssuedById" TEXT;

-- "No account should ever hold both." Enforced by the database, not just by
-- every write path remembering to. Cannot fail on existing data: setupCode is
-- NULL on every row the moment the column exists.
ALTER TABLE "User"
    ADD CONSTRAINT "User_single_credential_check"
    CHECK ("passwordHash" IS NULL OR "setupCode" IS NULL);

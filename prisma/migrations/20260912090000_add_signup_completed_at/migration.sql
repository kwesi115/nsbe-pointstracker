-- User.signupCompletedAt — the signup latch (see prisma/schema.prisma and
-- lib/signup.ts).
--
-- Null means the account is still mid-signup: every protected route sends it
-- to /join/resume, which derives WHERE to resume from the profile data. No step
-- index is stored, here or anywhere.
--
-- THE BACKFILL is the reason this file is more than one line. Every account
-- created before this column existed has NULL, and would be marched back
-- through a wizard it already completed. So rows that already satisfy
-- lib/signup.ts requiredSignupFieldsComplete are latched here, and only
-- genuinely incomplete ones are left to resume.
--
-- The WHERE clause below MIRRORS that predicate and must stay in step with it
-- (src/lib/signup.test.ts asserts the two agree, row for row, against this
-- database). Three properties worth naming, because they are easy to get wrong:
--
--   * Presence, not freshness. No membershipSeason/profileSeason comparison
--     appears below. Signup asks each question once; seasonal staleness is
--     check-in's concern (lib/core-form.ts getMissingFields). A returning
--     member whose classification is a season old has not become mid-signup.
--   * Answered, not true. duesPaidReported/nationalMemberReported are checked
--     IS NOT NULL, not = true. "No, not yet" is a complete answer to the
--     question the wizard asks.
--   * tshirtSize and resumeFileId are absent on purpose — both are optional at
--     signup and surface later via getMissingFields.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "signupCompletedAt" TIMESTAMP(3);

-- ADMIN and GUEST accounts have no member profile to finish.
--
-- An ADMIN account is a staff login: its step list stops at the account step
-- (see lib/signup.ts stepsFor), so no profile field can make it incomplete —
-- which is also what keeps the seeded officer accounts, several of which
-- deliberately carry a blank lastName, out of the resume flow. GUEST rows have
-- no password and can never sign in (see auth.ts authorize), so they have no
-- wizard at all.
UPDATE "User"
   SET "signupCompletedAt" = COALESCE("createdAt", now())
 WHERE "signupCompletedAt" IS NULL
   AND "role" IN ('ADMIN', 'GUEST');

-- GENERAL and EBOARD: every required step answered. Dated to createdAt rather
-- than now(), because that is closer to when the member actually finished.
UPDATE "User"
   SET "signupCompletedAt" = COALESCE("createdAt", now())
 WHERE "signupCompletedAt" IS NULL
   AND "role" IN ('GENERAL', 'EBOARD')
   -- about: name, student ID, classification, major
   AND "firstName" <> ''
   AND "lastName" <> ''
   AND "studentId" IS NOT NULL      AND "studentId" <> ''
   AND "classification" IS NOT NULL
   AND "major" IS NOT NULL           AND "major" <> ''
   AND ("major" <> 'Other' OR ("majorOther" IS NOT NULL AND "majorOther" <> ''))
   -- contact: phone and personal email (t-shirt size is optional)
   AND "phone" IS NOT NULL           AND "phone" <> ''
   AND "personalEmail" IS NOT NULL   AND "personalEmail" <> ''
   -- membership: both answered, either way
   AND "duesPaidReported" IS NOT NULL
   AND "nationalMemberReported" IS NOT NULL
   -- house: selected or already verified. A member who finished by pressing
   -- "I haven't taken the test yet" wrote nothing and is NOT matched here --
   -- they resume at the House step once, answer it, and are latched. That is
   -- the one case where the backfill is deliberately conservative: it cannot
   -- tell "declined the question" from "never reached the question".
   AND (("house" IS NOT NULL AND "house" <> '') OR "houseVerifiedAt" IS NOT NULL);

-- ShirtSize narrows to S, M, L, XL — XS, XXL and XXXL are gone.
--
-- Anyone holding a removed size is set to NULL rather than reassigned. Guessing
-- that an XS wearer takes an S (or that XXXL becomes XL) would put a wrong size
-- on an apparel order with nothing to show it was invented. NULL is honest, and
-- lib/core-form.ts getMissingFields re-asks at that member's next check-in and
-- lists it on /account until they answer.
--
-- Postgres cannot drop a value from an enum in place, so the type is rebuilt:
-- null out the removed values first (nothing can reference them afterwards),
-- swap the column onto a new type, then take the old name back. All inside the
-- single transaction scripts/db-apply-sql.ts wraps this file in.

-- 1. The affected members. Counted before and after in the run log.
UPDATE "User"
   SET "tshirtSize" = NULL
 WHERE "tshirtSize" IN ('XS', 'XXL', 'XXXL');

-- 2. The narrowed type.
CREATE TYPE "ShirtSize_new" AS ENUM ('S', 'M', 'L', 'XL');

-- 3. Move the column across. Every surviving value is still valid, and the
--    removed ones are NULL by now, so the cast cannot fail.
ALTER TABLE "User"
  ALTER COLUMN "tshirtSize" TYPE "ShirtSize_new"
  USING ("tshirtSize"::text::"ShirtSize_new");

-- 4. Retire the old type and take its name, so the schema keeps calling it ShirtSize.
DROP TYPE "ShirtSize";
ALTER TYPE "ShirtSize_new" RENAME TO "ShirtSize";

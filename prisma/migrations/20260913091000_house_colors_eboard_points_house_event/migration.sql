-- Three data changes to org-scoped configuration. The seed (prisma/seed.ts)
-- upserts all of this too, so a fresh deployment needs none of it — this is for
-- databases that already exist.

-- ---------------------------------------------------------------------------
-- 1. House colours: Dean and Latimer swap.
--
--      Jemison  red     #C8102E   (unchanged)
--      Latimer  green   #00843D   (was yellow)
--      Dean     yellow  #F2A900   (was green)
--      Johnson  black   #1A1A1A   (unchanged)
--
-- Config.HOUSES_LIST holds these as JSON (see lib/houses.ts). Two cases:
-- ---------------------------------------------------------------------------

-- 1a. A row holding valid JSON with both colours: swap them via a placeholder,
--     so the second replace can't undo the first. Only these two Houses use
--     these two colours, so swapping the values swaps the assignment.
UPDATE "Config"
   SET value = replace(replace(replace(value, '#00843D', '@@SWAP@@'), '#F2A900', '#00843D'), '@@SWAP@@', '#F2A900')
 WHERE key = 'HOUSES_LIST'
   AND value LIKE '%#00843D%'
   AND value LIKE '%#F2A900%';

-- 1b. A row predating the JSON format still holds the old pipe-delimited
--     string ("House A|House B|..."), which parseHouses rejects — so the app has
--     been falling back to DEFAULT_HOUSES all along. Write the canonical list so
--     the stored value matches what is actually rendered instead of being dead
--     data that silently disagrees.
UPDATE "Config"
   SET value = '[{"code":"JEMISON","name":"Jemison","color":"#C8102E"},{"code":"LATIMER","name":"Latimer","color":"#00843D"},{"code":"DEAN","name":"Dean","color":"#F2A900"},{"code":"JOHNSON","name":"Johnson","color":"#1A1A1A"}]'
 WHERE key = 'HOUSES_LIST'
   AND value NOT LIKE '[%';

-- ---------------------------------------------------------------------------
-- 2. E-Board categories carry 1 member point.
--
-- This does NOT change what an E-Board member scores. memberPointsFor (see
-- lib/points.ts) returns 0 for any role that isn't "general", so for an officer
-- this value is never read; their internal-board points come from eboardAwardFor,
-- a flat Config.EBOARD_POINT_VALUE per eboardEligible activity. The two cannot
-- double-count — different roles, different boards, different functions.
-- ---------------------------------------------------------------------------
UPDATE "EventCategory"
   SET "memberPoints" = 1
 WHERE code IN ('EBOARD_MEETING', 'EBOARD_RETREAT');

-- ---------------------------------------------------------------------------
-- 3. The House Event category, one per org, appended after whatever exists.
-- ---------------------------------------------------------------------------
INSERT INTO "EventCategory" (
  id, "orgId", code, name, "shortName", tier, "memberPoints", examples,
  "countsForMonthly", "eboardEligible", audience, active, "sortOrder",
  -- Prisma fills @default(now()) and @updatedAt for rows IT inserts; a raw
  -- INSERT has to supply both, since the columns are NOT NULL.
  "createdAt", "updatedAt"
)
SELECT
  -- cuid()-shaped enough to be a stable unique id; Prisma only generates these
  -- for rows IT inserts, so a raw INSERT has to supply one.
  'seed_house_event_' || substr(md5(o.id), 1, 12),
  o.id, 'HOUSE_EVENT', 'House Event', 'House', 3, 1, NULL,
  true, true, 'ALL', true,
  COALESCE((SELECT max("sortOrder") + 1 FROM "EventCategory" c WHERE c."orgId" = o.id), 0),
  now(), now()
FROM "Org" o
WHERE NOT EXISTS (
  SELECT 1 FROM "EventCategory" c WHERE c."orgId" = o.id AND c.code = 'HOUSE_EVENT'
);

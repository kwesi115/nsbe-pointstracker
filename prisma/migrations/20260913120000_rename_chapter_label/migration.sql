-- The chapter's display label is "Howard NSBE" everywhere — header, sign-in,
-- join, guest check-in, admin settings. The seed (prisma/seed.ts) writes the new
-- values for a fresh database, but it upserts Org and Config with `update: {}`,
-- so a database that already exists keeps the old ones until this runs.
--
-- Both statements match the exact old value only: a chapter that has already
-- renamed itself at /admin/settings keeps its own name.

-- Config.CHAPTER_NAME — MemberNav's header, the /pending copy, /admin/settings.
UPDATE "Config"
   SET value = 'Howard NSBE'
 WHERE key = 'CHAPTER_NAME'
   AND value = 'Howard University Chapter';

-- Org.name — preferred over CHAPTER_NAME on /signin, /join, the public and guest
-- layouts, and the chapter picker. shortName was already 'Howard NSBE'.
UPDATE "Org"
   SET name = 'Howard NSBE'
 WHERE slug = 'howard-nsbe'
   AND name = 'Howard University NSBE';

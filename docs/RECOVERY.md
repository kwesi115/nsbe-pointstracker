# Recovery

Two independent backup layers. Layer 1 (logical dump) is the real,
schema-complete backup — use it to restore Postgres itself. Layer 2 (season
snapshot workbook) is a human-readable safety net — use it when Postgres is
unrecoverable and you need to reconstruct what happened by hand, not to
restore the database directly.

## Layer 1 — restoring from a `pg_dump`

**What it is:** `scripts/backup-db.ts` (`npm run backup`) dumps the whole
database with `pg_dump`, gzips it, and uploads it to `backupStorage` (see
`src/lib/storage.ts`) under `db-backups/nsbe-{orgSlug}-{ISO8601}.sql.gz`,
pruning down to 7 daily / 4 weekly / 12 monthly. Scheduled nightly at
03:00 America/New_York via `.github/workflows/backup.yml` (a GitHub Actions
cron, not a Vercel Cron route — see that file's comments for why).

**Prerequisites:** `pg_dump`/`psql` (the `postgresql-client` package) on
whatever machine runs the restore, and `DATABASE_URL` pointing at the target
database.

**Steps:**

1. Get the dump. Download it from wherever `backupStorage` put it (S3/R2 —
   `BACKUP_S3_BUCKET`, key under `db-backups/`; or, in dev,
   `.backups/db-backups/` on local disk) to a local file, e.g. `dump.sql.gz`.
2. Run the restore script:
   ```
   npm run restore -- dump.sql.gz --confirm
   ```
3. Two guards, both required:
   - `--confirm` must be passed explicitly — the script refuses to run
     without it.
   - `DATABASE_URL` must contain `localhost`/`127.0.0.1`, **or**
     `RESTORE_ALLOW_REMOTE=true` must be set. Restoring into a database that
     doesn't look local requires that explicit opt-in. **This is
     deliberate** — a restore script that can silently overwrite production
     is worse than no restore script. To restore into a real remote
     database (disaster recovery, not local testing), set
     `RESTORE_ALLOW_REMOTE=true` and re-run — there is no other bypass.
4. The script gunzips the dump and pipes it into `psql "$DATABASE_URL"`
   (with Prisma's `?schema=` query param stripped first — `pg_dump`/`psql`
   don't understand it; see `scripts/pg-connection.ts`).

**Measured elapsed time** (this deployment's dev database — 61 users, 2 orgs,
a modest seeded dataset; larger production data will take longer,
proportionally):

- `pg_dump` + gzip: **941 ms** (178 KB raw → 40 KB gzipped)
- Restore (gunzip + `psql`) into a fresh scratch database: **1,727 ms**

Measured by actually running both steps against a real Postgres instance
(via the project's local `nsbe-postgres` Docker container) into a
purpose-created scratch database (`nsbe_pointstracker_restore_verify`),
verifying afterward that `User` and `Org` row counts in the restored database
exactly matched the source. Not estimated.

## Layer 2 — restoring from a season snapshot workbook

**What it is:** `writeSeasonSnapshot` (`src/lib/export/snapshot.ts`) exports
the full workbook (Members, Events, Registrations, Categories, Leaderboard,
E-Board Leaderboard, AdminLog, per-event Responses — see
`src/lib/export/workbook.ts`) and uploads it to the same `backupStorage` as
Layer 1, under `snapshots/{orgId}/`. Created automatically before a bulk
member import or a category point-value edit, and on demand from
`/admin/exports` → "Create season snapshot". Prior snapshots are listed there
with download links.

**This is not a one-command database restore.** A workbook is read-only,
human-readable data — the domain `Member` type it's built from doesn't carry
`passwordHash`, any verification token, or join codes (see
`workbook.test.ts`), so there's nothing in it a restore script could feed
back into `User` rows even if one existed. If Postgres itself is
unrecoverable and only a season snapshot survives:

1. Stand up a fresh database from `prisma/migrations/` (the schema, not the
   data) — `npm run db:migrate` against each migration in order, or
   `prisma migrate deploy` if the schema-engine binary isn't blocked in your
   environment (see `scripts/db-apply-sql.ts`'s own comment on this
   deployment's Windows Application Control constraint).
2. Run `npm run seed` to get Org/Config/EventCategory/the seven hardcoded
   officer accounts back.
3. Re-create member accounts from the workbook's Members sheet via the CSV
   bulk importer (`/admin/members` → Upload CSV) — export that sheet to CSV
   first (email, firstName, lastName, role columns).
4. Re-enter events, registrations, and awards by hand from the workbook's
   Events/Registrations/Categories sheets, or accept that granular
   attendance history is lost and only the season's final totals (visible in
   the Leaderboard/E-Board Leaderboard sheets) survive.

This is why Layer 1 is the real backup and Layer 2 is the fallback: Layer 2
gets you back to "we know who was a member and roughly what happened," not
"the database is restored." No elapsed time is quoted for this path — it's
manual reconstruction, not a script, and the time depends entirely on how
much history needs re-entering by hand.

## What's never in either backup

- `User.passwordHash` — real backups (Layer 1's `pg_dump`) do include it (a
  bcrypt hash, not plaintext) because that's what a real restore needs; it
  is never in the Layer 2 workbook (see `workbook.test.ts`).
- `JoinCode.code` (also bcrypt-hashed) — same split: present in the raw
  `pg_dump`, never in the workbook.
- Nothing in either layer is ever public. `backupStorage`'s S3/R2 driver
  (`BACKUP_STORAGE_DRIVER=s3`) never sets a public-read ACL/policy — unlike
  the user-upload `storage` driver's Vercel Blob option, which is
  intentionally public (unguessable URLs only). The default local-disk
  driver (`BACKUP_STORAGE_DRIVER` unset) is for dev/test only — a laptop's
  disk is not a production backup target.

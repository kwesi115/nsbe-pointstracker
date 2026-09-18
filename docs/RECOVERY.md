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

**Measured elapsed time — production, 2026-09-15** (Neon, PostgreSQL 18.6;
183 users, 1 org, 1,502 AdminLog rows, 209 registrations):

- `pg_dump` (18.6, direct endpoint, `--no-owner --no-privileges`) + gzip:
  **5,402 ms** (433 KB raw → 112 KB gzipped). Most of that is the network
  round-trip to Neon plus `docker run` startup, not dump work.
- Restore (gunzip + `psql`) into a fresh, empty PostgreSQL 18 scratch
  database: **1,435 ms** (13 ms gunzip + 1,422 ms `psql`), exit 0, zero
  `ERROR` lines.

Completeness was verified per table by primary key, not just by count: for
all 13 data tables, every row in the restored database exists in production,
and every production row missing from the restore was created after the
dump's newest row (production was taking live writes during the test). Not
estimated.

**End-to-end through R2, same day.** `npm run backup` was then run for real
against production (Linux container, `pg_dump` 18.6, `BACKUP_STORAGE_DRIVER=s3`):

- Whole script — dump, gzip, upload, prune, AdminLog write: **5,349 ms**.
- It produced `db-backups/nsbe-howard-nsbe-2026-09-15T22-50-49-739Z.sql.gz`,
  **117,247 bytes** gzipped (450,621 raw), and logged a matching `db_backup`
  AdminLog row.
- Restoring **that R2 object**: download 110 ms + gunzip 6 ms + `psql` 983 ms
  = **1,099 ms** (plus ~4.8 s to start the empty scratch container, excluded).
  Completeness re-verified by primary key across all 13 tables.

Caveats: both restores went into a throwaway `postgres:18-alpine` container
rather than through `npm run restore`, because the machine running this had no
Postgres client. Earlier dev-database figures (61 users: 941 ms dump, 1,727 ms
restore) are superseded by these.

**Retention pruning was verified against the live bucket**, not just in unit
tests: 105 synthetic dated objects plus the real backup were reduced to 20 —
the 7 most recent consecutive days, 12 distinct months, and the weekly
buckets in between. A second pass deleted nothing, and the real backup
survived. The synthetic objects were then removed.

**`sslmode=verify-full` needs a CA file for `pg_dump`/`psql`.** Unlike
node-postgres, libpq looks for `~/.postgresql/root.crt` and aborts with
"root certificate file ... does not exist" when it is missing. On a stock CI
runner, either copy the system bundle
(`cp /etc/ssl/certs/ca-certificates.crt ~/.postgresql/root.crt`) or put
`sslrootcert=system` in the connection string.

**`pg_dump` must be ≥ the server's major version.** Production is 18.x.
`pg_dump` 16, which is what `apt-get install postgresql-client` gives on
`ubuntu-latest`, aborts with "server version mismatch". Any machine that
runs a backup or restore needs a PostgreSQL 18 client.

### Known issues (as of 2026-09-15)

- **`.github/workflows/backup.yml` has failed on every scheduled run since it
  was added, and still will.** Three separate causes: it installs `pg_dump`
  16, which cannot dump the 18.6 server; it has no `~/.postgresql/root.crt`
  for `sslmode=verify-full`; and production had no
  `db_backup`/`db_backup_failed` AdminLog rows at all, which suggests the job
  fails before reaching the database (check the `DATABASE_URL` repo secret).
  A manual local run now succeeds, so the R2 secrets are the only part
  confirmed good — and only if the repo secrets hold the same values.
- **A season snapshot for production throws `Worksheet name already exists`.**
  `addReportSheet` truncates `Responses_{slug}` to Excel's 31-character limit,
  and the events `retest-prod-event-2026` and `retest-prod-event-2026-2`
  collide. This breaks both the manual snapshot button and the automatic
  snapshot before a bulk import or category edit.
- **`npm test` can delete production snapshots.** Tests load `.env`, which now
  selects the `s3` driver, and the dev database's org id (`howard-nsbe`) is
  the same as production's, so `snapshot.test.ts`'s cleanup deletes everything
  under `snapshots/howard-nsbe/`. Run tests with `BACKUP_STORAGE_DRIVER=local`
  until the test setup pins this itself.
- Resolved 2026-09-15: `BACKUP_S3_ACCESS_KEY_ID` had been set to the secret
  key's value (64 chars; R2 access key IDs are 32), so every R2 call failed
  with `InvalidArgument`.

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

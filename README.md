# NSBE Points Tracker

Chapter attendance and points tracking for Howard University NSBE — check-in, leaderboards,
membership eligibility, and season reporting, replacing the old shared Excel workbook.

## Table of contents

**For E-Board members and chapter officers**
- [What this is](#what-this-is)
- [The member experience](#the-member-experience)
- [The guest experience](#the-guest-experience)
- [How points work](#how-points-work)
- [Leaderboard eligibility](#leaderboard-eligibility)
- [The four NSBE Houses](#the-four-nsbe-houses)
- [Running an event](#running-an-event)
- [Roles and permissions](#roles-and-permissions)
- [Admin surfaces](#admin-surfaces)

**For developers**
- [Stack](#stack)
- [Architecture](#architecture)
- [Load-bearing design decisions](#load-bearing-design-decisions)
- [Repository layout](#repository-layout)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [Deployment](#deployment)

**Working with the data**
- [Every model](#every-model)
- [Stored vs. computed](#stored-vs-computed)
- [Three ways to inspect data](#three-ways-to-inspect-data)
- [SQL cookbook](#sql-cookbook)
- [Exports](#exports)
- [Making a correction safely](#making-a-correction-safely)
- [What NOT to edit directly](#what-not-to-edit-directly)

**Operations and handoff**
- [Backups](#backups)
- [Season rollover checklist](#season-rollover-checklist)
- [Rotating join codes](#rotating-join-codes)
- [Seeded admin accounts](#seeded-admin-accounts)
- [The admin email allowlist](#the-admin-email-allowlist)
- [Yearly handoff checklist](#yearly-handoff-checklist)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)

---

# For E-Board members and chapter officers

## What this is

This is the app Howard NSBE uses to track who came to what, and how many points they've
earned this season. Members scan one QR code at every event, sign in once, and tap through a
rotating check-in code to log their attendance — no sign-in sheet, no spreadsheet, no
double-entry. Everything you'd have kept in the old Excel workbook — the point system, the
leaderboard, dues/national membership tracking, House assignments — lives here instead, and
updates itself the moment someone checks in.

## The member experience

1. **Scan the chapter QR code.** It's posted at the meeting/event and never changes — see
   [Admin surfaces](#admin-surfaces) → QR code.
2. **Sign in.** First time, a member creates an account at `/join` (see below); after that,
   it's a normal email/password sign-in.
3. **Pick the open event.** The scan lands on the Events page, which shows whatever's open
   right now.
4. **Enter the rotating code.** The event's screen (the projector display) shows a 6-digit
   code that changes every 60 seconds. Type in whatever's on the screen at that moment.
5. **Confirm your profile.** The app only asks about what's actually missing or out of date —
   see [Roles and permissions](#roles-and-permissions) below for who sees what. A brand-new
   member fills in student ID, phone, classification, major, dues/National NSBE membership,
   House, and (optionally) a resume.
6. **Registered.** A confirmation screen shows the points just earned, the new season total,
   and current rank.

**A returning member with a complete, up-to-date profile does this in one tap** — after the
code, the app recognizes there's nothing left to ask and shows a "confirm and check in"
button instead of a form.

## The guest experience

Guests (recruiters, prospective members, visitors) never create a real account. At `/guest`
they enter a standing **guest pass code** (different from the codes members/E-Board/Admin use
to sign up), which shows only events that are open *right now* — never anything E-Board-only,
and no point value is ever shown, because guests don't earn points and never appear on any
leaderboard. A guest's check-in only asks for name, email, and affiliation — nothing about
dues, House, or a resume.

## How points work

Every event belongs to a **category**, and every category has a fixed point value. An admin
can edit these values (and add new categories) at `/admin/settings/categories` with no
developer needed.

| Category | Tier | Points per event |
|---|---|---|
| General Body Meeting (GBM) | 1 | 3 |
| Academic Excellence / Career Initiatives | 2 | 2 |
| Leadership / Talent Development | 2 | 2 |
| TORCH | 2 | 2 |
| Educational / Technical Excellence | 2 | 2 |
| Pre-Collegiate Initiative | 2 | 2 |
| Functional / Social | 3 | 1 |
| NSBE Week (per day) | — | 2 |
| E-Board Meeting | — | 0 (member track) |
| Retreat | — | 0 (member track) |

**Bonuses**, on top of event points:

| Bonus | Amount | Automatic or admin-awarded? |
|---|---|---|
| NSBE Week completion | +3 for attending 3–4 of the week's events, +5 for attending all 5 | **Automatic** — calculated the moment the last event in the week closes |
| Game/competition bonus | Admin's choice (form defaults to +1) | **Admin-awarded**, once per member per event |
| Monthly Engagement Champion | Admin's choice (form defaults to +5) | **Semi-automatic** — the app finds everyone tied for the most qualifying events in a closed month (minimum 2, configurable), but an admin has to click "Calculate" at `/admin/awards` to actually award it |
| Manual bonus | Admin's choice, any reason | **Admin-awarded**, no cap |
| E-Board internal track | +1 per qualifying activity (configurable at `/admin/settings`) | **Automatic** for any event an E-Board member attends, on a completely separate internal leaderboard — see below |

The **E-Board internal track** is not a bonus on top of the member leaderboard — it's a second,
separate scoreboard (`/admin/leaderboard`) that only E-Board members are on, scoring every
event they attend (including E-Board Meetings and the Retreat, which score 0 on the member
side) at a flat point value.

## Leaderboard eligibility

A member appears on the member leaderboard as soon as they've reported **both**:

- Chapter dues paid — **Yes**, for the current season
- National NSBE membership — **Yes**, for the current season

Reporting Yes to both puts a member on the board **immediately** — there's no waiting for
anyone to check anything. Admin verification (`/admin/verifications`) is a **spot-check
after the fact**, not a gate: it exists to catch a false claim, not to hold up a real one.
Points and attendance are always recorded the moment someone checks in, whether or not they're
currently eligible — a member who reports dues paid later doesn't lose any history, they just
start showing up on the board with everything they already earned.

## The four NSBE Houses

| House | Color |
|---|---|
| Jemison | 🔴 Red |
| Latimer | 🟡 Gold |
| Dean | 🟢 Green |
| Johnson | ⚫ Black |

(These are the defaults shipped with the app — a chapter can rename or recolor Houses at
`/admin/settings` with no code change.)

A member picks their House once, after taking the House Personality Test and uploading a
screenshot of the result. **Once an admin verifies a House, it's locked** — the check-in form
never asks again, and only an admin correcting a mistake (with a required note, for the
record) can change it after that.

## Running an event

1. **Create the event** — `/admin/events/new`: name, date, location, description.
2. **Assign a category** — this is what decides the point value; override the point value for
   this one event only if needed.
3. **Open registration** — from the Events board (`/admin`), pick a duration (15/20/30/45/60
   minutes) and hit **Open now**. The rotating code starts working the instant it opens.
4. **Project the code display** — click **Projector** on the open event to pull up the
   full-screen code + countdown + live check-in count. Put this on the room's screen.
5. **Watch the count** — the projector display and the Events board both show a live
   registration count while it's open.
6. **Extend or close** — **+10 min** if the room's still checking in when time's about to run
   out; **Close now** to cut it off early.
7. **Someone's phone died / doesn't have an account yet?** Don't wait — log them by hand at
   `/admin/attendance` → **Add attendance manually**, picking their name, the event, and a
   short note ("phone died," "forgot laptop," whatever's true). It shows up in the audit trail
   exactly like a self check-in.

## Roles and permissions

| Role | Can do |
|---|---|
| **GUEST** | Check in to open, all-audience events for 0 points. No login, no dashboard, never appears on any leaderboard. |
| **GENERAL** | Sign in, check in to any all-audience event, see their own dashboard/account/the member leaderboard. Cannot see E-Board-only events or any `/admin` page. |
| **EBOARD** | Everything GENERAL can, plus: create/open/close/extend/reopen events, run the membership audit queue (verify or reject a claimed dues/national/House), manage attendance by hand, award game-competition bonuses, pull the projector/QR display, run every export, and see E-Board-only events and the internal E-Board leaderboard. Their own check-ins score on the internal E-Board track, not the member one. |
| **ADMIN** | Everything EBOARD can, plus: manage members directly (change anyone's role or status, bulk-import a roster), create/rotate join codes, edit category point values and every chapter setting, manage NSBE Week groups, award manual bonuses, and calculate the Monthly Engagement Champion. |

**In plain terms:** role is the coarse lever, and there's one narrower one on top of it. An
ADMIN can grant a single GENERAL member the `verifications_write` permission from their
`/admin/members/[id]` page — that member reaches `/admin/verifications` and can verify/reject
dues, National membership, and House claims, and nothing else on the table above. Revoking it
takes effect on their very next request, not their next sign-in — nothing is cached in the
session token. See [`lib/permissions.ts`](src/lib/permissions.ts) (the engine — the only place a
grant is ever checked) and [`lib/repo.ts`](src/lib/repo.ts)'s `grantPermission`/
`revokePermission`/`hasPermission` (the only place one is ever written).

## Admin surfaces

| Page | What it's for |
|---|---|
| `/admin` | The events board — create, open, close, extend, reopen events; see who's checked in live. |
| `/admin/members` | The full roster — search/filter, bulk CSV import, change a role or status. |
| `/admin/verifications` | The membership audit queue — spot-check self-reported dues, National NSBE membership, and House claims. EBOARD/ADMIN always; a GENERAL member can reach this one page alone if granted `verifications_write` (see [Roles and permissions](#roles-and-permissions)). |
| `/admin/leaderboard` | The internal E-Board-only leaderboard (separate from the public member one). |
| `/admin/attendance` | Every check-in ever logged, editable — add one by hand, delete a mistake. |
| `/admin/groups` | NSBE Week (and any similar multi-event set) — assign events, set completion-bonus tiers, finalize early if a planned event gets canceled. |
| `/admin/awards` | Manual bonuses and the Monthly Engagement Champion calculation. |
| `/admin/exports` | Every downloadable report — full workbook, leaderboard CSV, member CSV — plus season snapshots (see [Backups](#backups)). |
| `/admin/settings` | Chapter name, season, email domain, core check-in form config, E-Board track config, and links to Houses/join codes. |
| `/admin/settings/categories` | Point values per category — the actual numbers in the [points table](#how-points-work) above. |
| `/admin/qr` | The one chapter QR code members scan to start check-in — print it, it never changes. |
| `/admin/join-codes` | Rotate the E-Board and Admin signup codes (Admin only — see [Rotating join codes](#rotating-join-codes)). |

---

# For developers

## Stack

| Piece | Why it's here |
|---|---|
| **Next.js 16** (App Router, Turbopack) | Server Components for every data-heavy page (no separate API layer to keep in sync), Server Actions for every mutation, Route Handlers only where a real HTTP endpoint is needed (registration, QR images, exports). |
| **TypeScript** | The domain types in `src/lib/types.ts` are the contract between the pure logic layer (`lib/points.ts`, `lib/core-form.ts`) and everything else — this only works if it's enforced at compile time. |
| **Prisma 7 (driver adapter, `@prisma/adapter-pg`)** | Prisma 7 requires an explicit driver adapter for SQL providers; `pg` is the underlying Postgres client. |
| **Postgres** | The system of record — see [Every model](#every-model). Excel is generated on demand, never stored as a file anyone edits. |
| **NextAuth v5 (Credentials)** | Email/password sessions; the JWT carries identity, but role/status is always re-read from the database on every privileged check — see [Load-bearing design decisions](#load-bearing-design-decisions). |
| **Zod** | Validates every form submission (core check-in form, extra event questions, join wizard) server-side, independent of whatever the client rendered. |
| **ExcelJS** | Generates the season workbook export on demand — no file on disk, no template to keep in sync with the schema. |
| **Vitest** | Unit and integration tests — see [Testing](#testing). |
| **Tailwind CSS v4** | Styling. |

## Architecture

A request from a member's phone to a stored `Registration` row crosses these layers:

```
┌──────────────┐     scan QR      ┌──────────────────┐
│  Member's    │ ───────────────► │  /events (page)   │  Server Component,
│  phone       │                  │  requireSession()  │  requireSession()
└──────────────┘                  └─────────┬─────────┘
                                             │ tap open event
                                             ▼
                                   ┌────────────────────┐
                                   │ /events/[id] (page) │  isOpen(event, now) —
                                   │ + CheckInFlow (client)│ a pure function of
                                   └─────────┬────────────┘ the clock, not a
                                             │ enter rotating code   status flag
                                             ▼
                          ┌──────────────────────────────────┐
                          │ POST /api/events/[id]/verify-code │  UX gate only —
                          │  verifyCode() (lib/code.ts)       │  never writes
                          └─────────────────┬──────────────────┘  anything
                                             │ code accepted → render form
                                             ▼
                        (skip the form entirely if getMissingFields()
                         returns nothing — see the "one tap" flow)
                                             │ submit
                                             ▼
                          ┌───────────────────────────────────┐
                          │ POST /api/events/[id]/register     │  Route Handler
                          │  → repo.registerForEvent()         │
                          └─────────────────┬───────────────────┘
                                             │ re-verifies the code AGAINST ITS
                                             │ OWN receivedAt — the real boundary
                                             ▼
                       ┌───────────────────────────────────────────┐
                       │ prisma.$transaction:                       │
                       │  1. write back core-form answers to User    │
                       │  2. INSERT Registration (eventId,userId      │
                       │     UNIQUE — the actual dedupe guarantee)    │
                       │  3. INSERT Answer rows (extra questions)     │
                       └───────────────────────────────────────────┘
                                             │
                                             ▼
                              standings recomputed on next read
                              (cached 30s — see lib/standings-cache.ts)
```

Every write goes through `src/lib/repo.ts` — it's the only module that imports Prisma
directly; nothing else in the app (pages, actions, route handlers) talks to the database.

## Load-bearing design decisions

**Points and ranks are derived at read time, never stored as a running total.**
`computeStandings` (`lib/points.ts`) re-sums every registration and award on every read
(cached — see below). *Buys:* editing a category's point value retroactively re-values every
past registration with zero backfill script — there is no `total_points` column that could
drift from reality. *Costs:* every leaderboard/dashboard load is a real computation, not a
row lookup (mitigated with a 30-second cache in front of the shared board — see
`lib/standings-cache.ts` — while a member's own just-earned points are always read fresh,
never from that cache).

**Event openness is a pure function of the clock — no cron, no status flag.**
`isOpen(event, now)` (`lib/points.ts`) just compares `now` against `opensAt`/`closesAt`.
*Buys:* nothing can ever get "stuck open" because a scheduled job failed to run; the answer is
always correct the instant you ask it. *Costs:* there's no server-side event that fires the
moment a window closes — the projector display and events board both poll, so a room can see
"closes in 0:03" for up to a few seconds after the real deadline before the UI catches up.

**Standard competition ranking — ties share a rank, next rank skips (1, 1, 3).**
`rankRows` (`lib/points.ts`). *Buys:* the ranking rule matches what everyone already expects
from sports/class rank; no arbitrary tiebreaker decides who's "really" #1. *Costs:* the raw
rank number alone doesn't tell you how many people are ahead of you — two people tied at rank
1 means the next person is rank 3, not 2.

**The `(eventId, userId)` unique constraint is the dedupe mechanism.**
Every registration path (member, guest, manual) does a friendly pre-check first, but the
Postgres unique constraint on `Registration` is what actually prevents a double check-in under
concurrent requests. *Buys:* correctness doesn't depend on application-level locking; a race
between two simultaneous submits always leaves exactly one row. *Costs:* "let me check in
again to fix a mistake" isn't self-service — an admin has to delete the old `Registration` row
first (`/admin/attendance`).

**Roster role is authority — the client never supplies a role.**
Every privileged check (`requireAdmin`/`requireEboard` in `lib/session.ts`) re-reads the
role from the database rather than trusting `session.user.role`. *Buys:* a promotion or
demotion takes effect on the very next request, not whenever a JWT happens to expire; a
tampered or stale client can't claim a role it doesn't have. *Costs:* one extra database
read on every gated page load and Server Action — small, but real, and deliberately paid
every time rather than cached.

**`getMissingFields` drives signup, check-in, and the account completeness panel from one
function.** (`lib/core-form.ts`.) *Buys:* there is exactly one definition of "what's still
missing" — the check-in form, the join wizard, and `/account`'s completeness panel can never
disagree with each other about what to ask. *Costs:* it's a single, fairly dense function with
many branches; adding a new profile field means touching this one place carefully; a bug here
affects three surfaces at once, not one.

**`profileSeason`/`membershipSeason` re-arm each season's questions with no batch job.**
Bumping `Config.SEASON` makes every member's stored season stamp stop matching immediately —
`getMissingFields` starts asking again the next time each member interacts with the app.
*Buys:* season rollover is a one-line Config edit, not a migration or a script run against
every user row. *Costs:* it's lazy, not push — a member who doesn't check in or visit
`/account` after the rollover won't be asked until they do; there's no way to force it early
for someone specific.

**Permissions are re-read from the DB on every write, never from the JWT.** Same mechanism
as the "roster role is authority" point above, stated as its own decision because it applies
to every Server Action and Route Handler, not just page loads. *Buys:* revoking access is
immediate everywhere, including in-flight write paths. *Costs:* the same extra DB read,
paid on every single mutation.

## Repository layout

```
prisma/                Schema, migrations, seed script
scripts/                Operational scripts — backup, restore, retention, raw-SQL migration apply
src/
  app/                  Routes (App Router) — grouped by (public)/(member)/(guest), plus
                         admin/ (the display route lives outside the member layout) and api/
  auth.ts                NextAuth config — Credentials provider, rate-limited login
  proxy.ts                Edge middleware — session/guest-pass routing, no DB access
  lib/
    repo.ts                The ONLY module that imports Prisma — every read/write goes through here
    points.ts               Pure scoring/ranking/open-window logic — no I/O
    core-form.ts             The check-in form's single source of truth (see above)
    code.ts                  Rotating check-in code generation/verification (HMAC, never stored)
    rate-limit.ts            In-process brute-force limiters (login, signup, check-in codes)
    standings-cache.ts        The 30s cache in front of the leaderboard (see above)
    storage.ts                 File storage (member uploads) + backup storage — both driver-swappable
    export/                  Excel workbook, CSV, season-snapshot builders
  components/            UI, grouped roughly by feature area
  generated/prisma/       Prisma Client output (gitignored, regenerated by `prisma generate`)
docs/
  RECOVERY.md             How to restore from a backup — see [Backups](#backups)
.github/workflows/
  backup.yml               The nightly backup cron (GitHub Actions, not Vercel — see below)
```

## Local setup

Requires Node 20+, a Postgres instance you can point `DATABASE_URL` at (a local Docker
container is fine — this is what the maintainers use), and `npm`.

```bash
# 1. Clone this repository, then, from its root:
npm install

# 2. Configure environment — Prisma's CLI only reads .env (not .env.local), so
#    DATABASE_URL specifically must live in .env. Everything else can go in
#    either file; .env.local is the convention for the rest.
cp .env.example .env
# edit .env: at minimum set DATABASE_URL, AUTH_SECRET, AUTH_URL, CODE_SECRET

# 3. Apply the schema
npx prisma migrate deploy

# 4. Seed
npm run seed          # real seed: Org, categories, Config, join codes, the seven
                       # hardcoded Howard NSBE officer accounts, and INITIAL_ADMIN_EMAILS
npm run seed:fake     # optional — adds 40 fake GENERAL members, 3 fake EBOARD members,
                       # 1 fake ADMIN, ~7 past events + an NSBE Week group, ~100
                       # registrations, 2 game bonuses, and 1 materialized monthly
                       # champion, so every /admin page has something to look at

# 5. Run
npm run dev            # http://localhost:3000
```

**Reset to a working state:** the seed script is idempotent by design — re-running
`npm run seed` never resets an existing password or re-generates a join code that's already
been handed out; it only fills in what's missing. There is no separate "reset" command. To
truly start over, drop and recreate the database, then repeat steps 3–4.

**A note on migrations:** `npx prisma migrate deploy` is the standard path and is what's
verified above. `scripts/db-apply-sql.ts` exists as a fallback for an environment where
Prisma's schema-engine binary is blocked (e.g. by Windows Application Control policy) — it
applies one raw `.sql` file directly, in its own transaction, and does **not** update Prisma's
own migration-tracking table, so don't mix the two approaches against the same database. Usage:
```bash
npm run db:migrate -- prisma/migrations/0001_init/migration.sql
```

## Environment variables

| Variable | Required? | What it does | Example |
|---|---|---|---|
| `DATABASE_URL` | **Required** | Postgres connection string. Must be in `.env`, not `.env.local` — the Prisma CLI only loads `.env`. | `postgresql://nsbe:pw@localhost:5432/nsbe_pointstracker?schema=public` |
| `AUTH_SECRET` | **Required** | NextAuth's session-signing secret. | (generate with `openssl rand -base64 32`) |
| `AUTH_URL` | **Required** | The app's own base URL — also what the chapter QR code encodes (`/events`). | `https://points.howardnsbe.org` |
| `CODE_SECRET` | **Required** | HMAC key for rotating check-in codes (`lib/code.ts`). Rotating this instantly changes every currently-displayed code. | (any non-empty random string) |
| `INITIAL_ADMIN_EMAILS` | Optional | Comma-separated emails seeded as ADMIN accounts on first `npm run seed`. | `you@gmail.com` |
| `SEED_ADMIN_PASSWORD` | Optional | Shared initial password for the seven hardcoded officer accounts (bcrypt-hashed at seed time). They sign in with it and reach `/admin` directly — `mustChangePassword` is deliberately not set for these seven. Falls back to `howard1867`. | `some-temp-password` |
| `EBOARD_EMAILS` | Optional | Comma-separated — the standing officer roster. Promotes an existing account to EBOARD or seeds an unclaimed EBOARD placeholder, separate from the seven hardcoded accounts. | `officer@bison.howard.edu` |
| `SEED_FAKE` | Optional | Exact string `"true"` seeds a full dev/demo season on top of the production seed (`npm run seed:fake`). Refuses outright if `NODE_ENV=production`. | `true` |
| `STORAGE_DRIVER` | Optional | Member file uploads (House proof, resume). Unset = local disk (`.uploads/`, dev only). | `vercel-blob` |
| `BACKUP_STORAGE_DRIVER` | Optional | Database backups and season snapshots — deliberately separate from `STORAGE_DRIVER` above. Unset = local disk (`.backups/`, dev/test only — **not** a real backup target). | `s3` |
| `BACKUP_S3_BUCKET` / `BACKUP_S3_REGION` / `BACKUP_S3_ENDPOINT` / `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | Required if `BACKUP_STORAGE_DRIVER=s3` | Private S3/R2 target for backups — the bucket must **not** have public read access. `BACKUP_S3_ENDPOINT` is only needed for R2, not real AWS S3. | — |
| `RESTORE_ALLOW_REMOTE` | Optional | Explicit opt-in required for `scripts/restore-db.ts` to run against a non-localhost `DATABASE_URL`. | `true` |
| `CLEAR_SEED_ALLOW_PRODUCTION` | Optional | Explicit opt-in required for `scripts/clear-seed-data.ts` to run when `NODE_ENV=production`. | `true` |

`.env.example` at the repo root documents every variable in the table above.

## Testing

```bash
npm test          # vitest run — everything, once
npm run test:watch # vitest — watch mode
```

24 test files, covering: pure logic (`points.ts`, `core-form.ts`, `code.ts`, join-wizard
rules), the rate limiters, session/permission guards, the export builders (including a
regression test that scans the generated workbook for any bcrypt-hash or credential-shaped
substring), the backup/restore scripts' pure logic (retention math, the `?schema=`
connection-string strip, the restore safety guards), and integration tests in `repo.test.ts`
that run against a real Postgres database (no mocking) for the write paths — registration,
role changes, eligibility, award revocation, standings-cache invalidation.

**Security-boundary files that must not change without tests alongside them:**

- `src/lib/code.ts` — the rotating check-in code itself (HMAC + constant-time compare).
- `src/lib/repo.ts`'s `registerForEvent`/`registerGuest` — the actual security boundary for
  check-in (the UX-gate Route Handler/Server Action only gate the *form's render*; these two
  re-verify the code independently against their own timestamp).
- `src/lib/rate-limit.ts` — every brute-force limiter (login, signup, check-in codes,
  per-event lock).
- `src/lib/session.ts` — every `require*` guard.
- `scripts/restore-guards.ts` — the restore script's refuse-without-`--confirm` and
  refuse-remote-without-`RESTORE_ALLOW_REMOTE` checks.

## Deployment

**Host requirements:** Node 20+, a reachable Postgres database, and — only for the nightly
backup — a runner with the `pg_dump`/`psql` client tools on `PATH` (see
`.github/workflows/backup.yml`, a GitHub Actions cron, deliberately **not** a Vercel Cron
Route Handler, because Vercel's default Node serverless runtime doesn't ship `pg_dump`).

**This can run on multiple instances now** — there is no server-local mutable state in the
request path itself; every write goes through Postgres, and the standings cache
(`lib/standings-cache.ts`) is Next.js's own `unstable_cache`, which is safe across instances.

**Two places still assume a single instance — the in-process rate limiters**
(`src/lib/rate-limit.ts`): every limiter (login, signup, file upload, join-code attempts,
guest check-in, per-member check-in-code attempts, and the per-event check-in-code
brute-force lock) is a plain in-memory `Map`, scoped to one Node process. Running more than
one instance today means each instance enforces its own limits independently — an attacker
gets N instances' worth of attempts before any single one trips. If this ever needs to run
multi-instance in front of real traffic, every one of those `Map`s needs to move to a shared
store (Redis/Upstash is the natural choice) — the file's own header comment says this
explicitly.

---

# Working with the data

## Every model

| Model | Represents | Key fields | Relationships | Unique constraints (and why) |
|---|---|---|---|---|
| **Org** | One chapter. Everything else below is scoped to an `orgId` so a second chapter could onboard without a data migration, even though only one (`howard-nsbe`) exists today. | `slug`, `name`, `active` | Parent of everything else | `slug` unique — it's the public URL segment (`/org/[slug]`). |
| **User** | Every account — member, officer, admin, or guest. One table for all four roles. | `email`, `passwordHash` (nullable — guests have none), `role`, `status`, `duesPaidReported`/`nationalMemberReported` + their `*VerifiedAt`/`*RevokedAt` audit trail, `membershipSeason`, `profileSeason`, `house`/`houseVerifiedAt` | Owns `Registration`, `PointAward`, `UploadedFile`, `AdminLog` entries (as actor) | `(orgId, email)` unique — one account per email per chapter (not globally unique, since a second org could reuse an email). |
| **JoinCode** | The signup security boundary — a bcrypt-hashed code that grants a specific role on redemption. | `code` (hashed), `codeHint`, `grantsRole`, `active`, `maxUses`/`useCount`, `expiresAt` | Belongs to `Org`; tracks `createdBy` | No unique constraint on the code itself (it's hashed and compared by trying candidates) — `label` is how a chapter tells its E-Board code from its Admin code apart in the UI. |
| **EventCategory** | "What kind of activity is this" — tier, point value, whether it feeds the Monthly Champion calc, whether it counts on the E-Board track, audience. | `code`, `memberPoints`, `tier`, `countsForMonthly`, `eboardEligible`, `audience` | Has many `Event` | `(orgId, code)` unique — `code` is the stable machine key (e.g. `GBM`) the seed script and any future migration reference; `name`/`memberPoints` are freely editable without breaking that reference. |
| **EventGroup** | An NSBE-Week-shaped set of events whose completion bonus can only be known once the last event closes. | `kind`, `expectedEventCount`, `bonusTiers` (JSON — `[{min,max,bonus}]`), `finalizedAt` | Has many `Event` | `(orgId, slug)` unique. |
| **Event** | One check-in-able thing — a GBM, a workshop, an E-Board meeting. | `slug`, `categoryId`, `groupId`, `opensAt`/`closesAt`, `status`, `pointsOverride`, `audience` | Belongs to `EventCategory`, optionally `EventGroup`; has many `Registration`, `FormField`, `PointAward` | `(orgId, slug)` unique — the URL segment. |
| **FormField** | One extra, event-specific question (beyond the fixed core check-in form). | `fieldKey`, `type`, `required`, `options`, `order` | Belongs to `Event` (cascade-deletes with it) | `(eventId, fieldKey)` unique — a question can't be defined twice on the same event. |
| **Registration** | One check-in. The actual attendance ledger. | `pointsAwarded` (a historical snapshot only — see [Stored vs. computed](#stored-vs-computed)), `roleAtTime`, `source` (FORM/MANUAL), plus an audit snapshot of the core-form answers at submit time | Belongs to `Event` and `User`; has many `Answer` | **`(eventId, userId)` unique — this is THE dedupe mechanism.** It's what makes a double check-in structurally impossible under Postgres, not just something the app tries to prevent. |
| **Answer** | One extra-question response, normalized (not a JSON blob) so exports and the responses grid are plain queries. | `fieldKey`, `value` | Belongs to `Registration` (cascade-deletes with it) | `(registrationId, fieldKey)` unique — one answer per question per registration. |
| **PointAward** | A bonus not tied to a check-in — game/competition, Monthly Champion, or manual. | `kind`, `points`, `eventId` (required for GAME_COMPETITION), `periodMonth` (required for MONTHLY_CHAMPION), `revokedAt`/`revokedById`/`revokeNote` | Belongs to `User`; optionally `Event` | **Two constraints, each only biting on the kind it's named for** (Postgres treats `NULL` as distinct, so a `MANUAL` award with both `eventId` and `periodMonth` null never collides): `(orgId, userId, kind, eventId)` caps a game bonus at one per member per event; `(orgId, userId, kind, periodMonth)` caps Monthly Champion at one per member per month. |
| **UploadedFile** | A House-proof screenshot or resume. Never publicly addressable — always served through `GET /api/files/[id]`, which checks owner-or-EBOARD. | `kind`, `storageKey` (a driver-internal handle, never a public URL), `originalName`, `mimeType`, `sizeBytes` | Belongs to `User` | — |
| **Config** | Every chapter setting — season, point values for the E-Board track, form config, external links, brute-force thresholds. Flat key/value, not a typed table. | `key`, `value` (always a string; callers coerce) | Belongs to `Org` | `(orgId, key)` unique — one value per setting per chapter. |
| **AdminLog** | The audit trail. Every admin mutation writes one row, in the same transaction as the mutation itself — never a best-effort write after the fact. | `action`, `target`, `detail`, `actorId` (nullable — a seed-run or a system-triggered event like a brute-force lock has no human actor) | Belongs to `Org`; optionally `User` (actor) | — |
| **PermissionGrant** | A narrow, revocable capability grant to one member — the permissions engine (see [Roles and permissions](#roles-and-permissions)). Checked live on every request, never cached in the session. | `permission` (only `VERIFICATIONS_WRITE` today), `grantedAt`/`grantedById`, `revokedAt`/`revokedById` | Belongs to `User` (cascade-deletes with it — a deleted member's grants are meaningless); tracks `grantedBy`/`revokedBy` | `(orgId, userId, permission)` unique — one row per capability per member; granting after a revoke reuses the row (resets `revokedAt` to null) instead of inserting a second one, so the grant/revoke history stays on a single row. |

## Stored vs. computed

If you're looking for a `total_points` column: **it does not exist, on purpose.** See
[Load-bearing design decisions](#load-bearing-design-decisions) above.

**Stored:**
- Every `Registration` row (who attended what, when, with what answers) — this is the
  permanent record.
- `Registration.pointsAwarded` — but this is a **historical snapshot for display/audit only**,
  never read by the leaderboard. It's what an old CSV export shows even after a category's
  point value later changes.
- Every `PointAward` row (game bonus, Monthly Champion, manual) — these ARE the bonus; there's
  nothing further to compute once awarded, other than whether it's currently revoked.
- Every profile field on `User` (dues/national self-report, House, classification, major,
  resume, etc.) — the live source of truth for all of these.

**Computed at read time, every time, never cached beyond the 30-second standings window:**
- A member's current point total and rank (`computeStandings` in `lib/points.ts`) — sums live
  `Registration`s against the event's **current** category point value (or its own
  `pointsOverride`), plus every non-revoked `PointAward`.
- Whether an event is open right now (`isOpen`) — a comparison against the clock, never a
  stored boolean.
- Whether a member is eligible for the leaderboard (`isEligible`) — reads `duesPaidReported`/
  `nationalMemberReported`/`membershipSeason` fresh every time.
- The NSBE Week completion bonus (`groupBonusFor`) — never materialized as a `PointAward`;
  purely computed from the group's events and the member's attendance among them.
- What the check-in form still needs to ask (`getMissingFields`) — derived from the member's
  current profile fields against the current `Config.SEASON`, not stored anywhere as "form
  state."

## Three ways to inspect data

**1. In the app.** For anything you'd normally need, this is the intended way:
`/admin/members` (search/filter the roster, click into one member's detail page for their
full history), the responses grid on any past event's page (`/admin/events/[id]/responses`),
and `/admin/attendance` for the raw check-in log. There is no single `/admin/audit` page —
`AdminLog` entries surface contextually (e.g. a member's detail page shows their own log
entries) rather than as one global feed.

**2. Prisma Studio.** A local, browser-based data browser/editor:

```bash
npx prisma studio
```

Good for a quick look at any table with real relations rendered as clickable links, and for
one-off reads. **Be careful: it writes.** Studio has no concept of this app's business rules —
it will happily let you edit a `Registration`'s `pointsAwarded` or delete a row with no
`AdminLog` entry, no revalidation, and no re-derivation of anything downstream. Treat it as a
read tool; make writes through the app (or SQL, deliberately, per
[Making a correction safely](#making-a-correction-safely)) instead.

**3. SQL.** Connect directly with `psql` or a GUI client (TablePlus, Postico, DBeaver, the
Neon/your host's own console — whatever you have) using the same connection string as
`DATABASE_URL`:

```bash
psql "$DATABASE_URL"
```

Table and column names match the Prisma model names exactly and are case-sensitive — quote
them: `SELECT * FROM "User" WHERE "orgId" = 'howard-nsbe';`, not `select * from user`.

## SQL cookbook

Every query below was run against this project's own seeded database and returned real rows.
Replace `'howard-nsbe'` with your org's actual id if it differs (`SELECT id, slug FROM "Org";`
to check).

**1. Current leaderboard, with a points breakdown** (event points + bonus awards by kind —
does *not* include the NSBE Week completion bonus, which is never stored; see
[Stored vs. computed](#stored-vs-computed)):
```sql
SELECT
  u."firstName", u."lastName", u.email,
  COALESCE(ev.event_points, 0) AS event_points,
  COALESCE(ba.game_points, 0) AS game_bonus,
  COALESCE(ba.monthly_points, 0) AS monthly_champion_bonus,
  COALESCE(ba.manual_points, 0) AS manual_bonus,
  COALESCE(ev.event_points, 0) + COALESCE(ba.game_points, 0)
    + COALESCE(ba.monthly_points, 0) + COALESCE(ba.manual_points, 0) AS total_shown
FROM "User" u
LEFT JOIN (
  SELECT r."userId", SUM(COALESCE(e."pointsOverride", ec."memberPoints")) AS event_points
  FROM "Registration" r
  JOIN "Event" e ON e.id = r."eventId"
  JOIN "EventCategory" ec ON ec.id = e."categoryId"
  GROUP BY r."userId"
) ev ON ev."userId" = u.id
LEFT JOIN (
  SELECT "userId",
    SUM(points) FILTER (WHERE kind = 'GAME_COMPETITION') AS game_points,
    SUM(points) FILTER (WHERE kind = 'MONTHLY_CHAMPION') AS monthly_points,
    SUM(points) FILTER (WHERE kind = 'MANUAL') AS manual_points
  FROM "PointAward"
  WHERE "revokedAt" IS NULL
  GROUP BY "userId"
) ba ON ba."userId" = u.id
WHERE u."orgId" = 'howard-nsbe' AND u.role = 'GENERAL'
  AND u."duesPaidReported" = true AND u."nationalMemberReported" = true
  AND u."membershipSeason" = (SELECT value FROM "Config" WHERE "orgId" = 'howard-nsbe' AND key = 'SEASON')
ORDER BY total_shown DESC;
```

**2. Who attended a given event** (replace the slug):
```sql
SELECT u."firstName", u."lastName", u.email, r."createdAt", r."pointsAwarded", r.source
FROM "Registration" r
JOIN "User" u ON u.id = r."userId"
JOIN "Event" e ON e.id = r."eventId"
WHERE e.slug = 'your-event-slug-here'
ORDER BY r."createdAt";
```

**3. Members missing dues or national membership:**
```sql
SELECT "firstName", "lastName", email,
  COALESCE("duesPaidReported", false) AS dues_reported,
  COALESCE("nationalMemberReported", false) AS national_reported
FROM "User"
WHERE "orgId" = 'howard-nsbe' AND role = 'GENERAL'
  AND (COALESCE("duesPaidReported", false) = false OR COALESCE("nationalMemberReported", false) = false)
ORDER BY "lastName";
```

**4. T-shirt size counts, for an order:**
```sql
SELECT "tshirtSize", COUNT(*) AS members
FROM "User"
WHERE "orgId" = 'howard-nsbe' AND "tshirtSize" IS NOT NULL
GROUP BY "tshirtSize"
ORDER BY "tshirtSize";
```

**5. Attendance by House:**
```sql
SELECT COALESCE(u.house, '(none)') AS house, COUNT(r.id) AS registrations, COUNT(DISTINCT u.id) AS distinct_members
FROM "User" u
LEFT JOIN "Registration" r ON r."userId" = u.id
WHERE u."orgId" = 'howard-nsbe' AND u.role = 'GENERAL'
GROUP BY u.house
ORDER BY registrations DESC;
```

**6. Members who have never checked in:**
```sql
SELECT u."firstName", u."lastName", u.email, u."createdAt"
FROM "User" u
WHERE u."orgId" = 'howard-nsbe' AND u.role = 'GENERAL'
  AND NOT EXISTS (SELECT 1 FROM "Registration" r WHERE r."userId" = u.id)
ORDER BY u."createdAt";
```

**7. E-Board internal standings** (flat `EBOARD_POINT_VALUE` per qualifying event):
```sql
SELECT u."firstName", u."lastName", u.email, u."eboardPosition",
  COUNT(r.id) AS events_attended,
  COUNT(r.id) FILTER (WHERE ec."eboardEligible")
    * (SELECT value FROM "Config" WHERE "orgId" = 'howard-nsbe' AND key = 'EBOARD_POINT_VALUE')::int AS eboard_points
FROM "User" u
JOIN "Registration" r ON r."userId" = u.id
JOIN "Event" e ON e.id = r."eventId"
JOIN "EventCategory" ec ON ec.id = e."categoryId"
WHERE u."orgId" = 'howard-nsbe' AND u.role = 'EBOARD'
GROUP BY u.id
ORDER BY eboard_points DESC;
```

**8. NSBE Week completion counts per member:**
```sql
SELECT u."firstName", u."lastName", u.email, COUNT(r.id) AS attended, g."expectedEventCount"
FROM "EventGroup" g
JOIN "Event" e ON e."groupId" = g.id
JOIN "Registration" r ON r."eventId" = e.id
JOIN "User" u ON u.id = r."userId"
WHERE g."orgId" = 'howard-nsbe' AND u.role = 'GENERAL'
GROUP BY u.id, g.id, g."expectedEventCount"
ORDER BY attended DESC;
```

**9. Monthly attendance counts, for verifying a Monthly Engagement Champion calculation**
(replace the month):
```sql
SELECT u."firstName", u."lastName", u.email, COUNT(r.id) AS countable_events
FROM "Registration" r
JOIN "User" u ON u.id = r."userId"
JOIN "Event" e ON e.id = r."eventId"
JOIN "EventCategory" ec ON ec.id = e."categoryId"
WHERE u."orgId" = 'howard-nsbe' AND u.role = 'GENERAL' AND ec."countsForMonthly" = true
  AND to_char(e."closesAt", 'YYYY-MM') = '2026-07'
GROUP BY u.id
HAVING COUNT(r.id) >= (SELECT value FROM "Config" WHERE "orgId" = 'howard-nsbe' AND key = 'MONTHLY_CHAMPION_MIN_EVENTS')::int
ORDER BY countable_events DESC;
```

**10. Profile completeness gaps for the current season:**
```sql
SELECT "firstName", "lastName", email,
  (classification IS NULL) AS missing_classification,
  (major IS NULL) AS missing_major,
  (house IS NULL AND "houseVerifiedAt" IS NULL) AS missing_house,
  ("resumeFileId" IS NULL) AS missing_resume,
  ("profileSeason" IS DISTINCT FROM (SELECT value FROM "Config" WHERE "orgId" = 'howard-nsbe' AND key = 'SEASON')) AS profile_stale_this_season
FROM "User"
WHERE "orgId" = 'howard-nsbe' AND role = 'GENERAL'
ORDER BY "lastName";
```

**11. Who currently holds elevated access** (this app has no separate permission-grant table
— see [Roles and permissions](#roles-and-permissions) — so this IS the full answer to
"permission grants currently active"):
```sql
SELECT "firstName", "lastName", email, role, "eboardPosition"
FROM "User"
WHERE "orgId" = 'howard-nsbe' AND role IN ('ADMIN', 'EBOARD')
ORDER BY role, "lastName";
```

**12. Registrations added manually, with their notes:**
```sql
SELECT u."firstName", u."lastName", u.email, e.name AS event, r."createdAt", r.note
FROM "Registration" r
JOIN "User" u ON u.id = r."userId"
JOIN "Event" e ON e.id = r."eventId"
WHERE e."orgId" = 'howard-nsbe' AND r.source = 'MANUAL'
ORDER BY r."createdAt" DESC;
```

**13. All activity for one member** (replace the email):
```sql
SELECT 'registration' AS kind, e.name AS what, r."createdAt" AS "when", r."pointsAwarded"::text AS points
FROM "Registration" r JOIN "Event" e ON e.id = r."eventId" JOIN "User" u ON u.id = r."userId"
WHERE u.email = 'member@bison.howard.edu'
UNION ALL
SELECT 'award' AS kind, pa.reason AS what, pa."awardedAt" AS "when", pa.points::text AS points
FROM "PointAward" pa JOIN "User" u ON u.id = pa."userId"
WHERE u.email = 'member@bison.howard.edu'
ORDER BY "when";
```

**14. Everything logged about one member's account** (replace the email):
```sql
SELECT al.action, al.target, al.detail, al."createdAt", actor.email AS actor_email
FROM "AdminLog" al
LEFT JOIN "User" actor ON actor.id = al."actorId"
WHERE al."orgId" = 'howard-nsbe' AND al.target = 'member@bison.howard.edu'
ORDER BY al."createdAt" DESC;
```

**15. Category point values currently in effect:**
```sql
SELECT code, name, tier, "memberPoints", "eboardEligible", "countsForMonthly", audience, active
FROM "EventCategory"
WHERE "orgId" = 'howard-nsbe'
ORDER BY "sortOrder";
```

## Exports

| Export | Where | Contains | Deliberately stripped |
|---|---|---|---|
| Full season workbook (`.xlsx`) | `/admin/exports` | Members, Events, Registrations, Categories, Leaderboard, E-Board Leaderboard, AdminLog, and one Responses sheet per event | `passwordHash`, any verification token, join codes — not filtered out at export time, but structurally absent: the domain `Member` type the export reads from has no such fields to begin with. Regression-tested (`workbook.test.ts` scans every cell of the generated file for a bcrypt-hash prefix or a credential-shaped substring). |
| Leaderboard (`.csv`) | `/admin/exports` | Rank, name, email, points, events attended | Same as above (no credential fields exist on the source data). |
| E-Board leaderboard (`.csv`) | `/admin/leaderboard` | Rank, name, position, and the full chapter/E-Board-meeting/retreat point breakdown | Same. |
| One event's responses (`.csv`) | that event's Responses page | Name, email, timestamp, points, every extra-question answer | Same. |
| Members (`.csv`) | `/admin/members` → "Export selected" | Name, email, classification, major, dues/national/eligible/House/resume state, role, points, events | Same. |
| Season snapshot (`.xlsx`) | `/admin/exports` → "Create season snapshot" | Identical contents to the full workbook above — this is the same builder, just uploaded to backup storage with a timestamp instead of downloaded directly. See [Backups](#backups). | Same. |

## Making a correction safely

**None of these need a "recompute" step** — because points and ranks are never stored (see
[Stored vs. computed](#stored-vs-computed)), the very next page load already reflects the
fix. There's no cache to bust beyond the 30-second standings window (which any of these
mutations invalidates immediately anyway).

| Situation | How | Note |
|---|---|---|
| **Wrong registration** (wrong event, duplicate, shouldn't count) | `/admin/attendance` → delete the row. Re-add correctly by hand if needed. | Deleting is logged to `AdminLog`. |
| **Revoke a bonus** | `/admin/awards` → find the award → Revoke, with a required note. | The award row is never deleted — `revokedAt`/`revokeNote` preserve the full history of what was granted and why it was taken back. |
| **Change a verified House** | Member's detail page (`/admin/members/[id]`) → correct House, with a required note. | This is the *only* path to change a House once it's verified — the check-in form never re-asks after verification. |
| **Reverse a role change** | `/admin/members` → change the role back. | The prior role isn't automatically restored from history — you're making a new, ordinary role change. Every role change (both directions) is logged. |

## What NOT to edit directly

Editing these directly in the database (via Prisma Studio or raw SQL) bypasses the app's
audit trail and its business rules — do it through the app instead:

- **`Registration` rows** — the `(eventId, userId)` unique constraint and the audit-snapshot
  fields (`classificationAtTime`, `eligibleAtTime`, etc.) are meant to be written exactly once,
  by `registerForEvent`/`registerGuest`/`addManualAttendance`. A hand-edited row has no
  `AdminLog` entry explaining why it exists.
- **Any `*VerifiedAt`/`*RevokedAt` timestamp** (dues, national, House) — these are meant to be
  set only by the corresponding `verify*`/`revoke*` function, which also resolves and stores
  the actor and (for a revoke) requires a note. A hand-set timestamp has no accountable
  "who and why."
- **Anything that should produce an `AdminLog` entry** — which, in this app, is almost every
  write an admin makes. If you're about to change something a real admin action would also
  change, use that action instead of touching the row directly, or you'll have a database that
  doesn't match its own audit trail.

---

# Operations and handoff

## Backups

**Automatic — nightly, no action needed.** `scripts/backup-db.ts` (`npm run backup`) runs a
full `pg_dump`, gzips it, uploads it to backup object storage, and prunes down to 7 daily /
4 weekly / 12 monthly. Scheduled via `.github/workflows/backup.yml` at 03:00
America/New_York (GitHub Actions cron, not Vercel — see [Deployment](#deployment)).

**Manual — on demand or automatically before a risky change.** `/admin/exports` → "Create
season snapshot" writes the full human-readable workbook to the same backup storage. This
also fires automatically before a bulk member import or a category point-value edit.

**Where they go:** the same object storage, driver-swappable
(`BACKUP_STORAGE_DRIVER`/`BACKUP_S3_*` — see [Environment variables](#environment-variables)).
The bucket must never be public.

**Full restore instructions, prerequisites, and a real measured restore time:
[`docs/RECOVERY.md`](docs/RECOVERY.md).**

## Season rollover checklist

1. At `/admin/settings`, change **Season** (e.g. `2026-2027` → `2027-2028`).
2. That's it for the automatic part: every member's `profileSeason` and `membershipSeason`
   stop matching the new value immediately, which re-arms the classification/major and
   dues/National-NSBE questions at each member's *next* check-in or `/account` visit — see
   [Load-bearing design decisions](#load-bearing-design-decisions). No script, no bulk update.
3. **What does NOT reset automatically:** the leaderboard itself (past `Registration`s and
   `PointAward`s stay exactly as they are — nothing is archived or zeroed), House
   verification (still locked, still carries over), role/status, and every `Config` value
   other than `SEASON` itself. If the new season should start certain members over on the
   leaderboard, that's a deliberate, separate decision — not something the season bump does
   for you.
4. Take a season snapshot first (`/admin/exports`) so the old season's final state is
   captured before anyone's stale data starts getting re-asked.

## Rotating join codes

`/admin/join-codes` (Admin only). Rotate the **E-Board** and **Admin** codes:

- Whenever someone who had one leaves E-Board/Admin, or you suspect a code was shared beyond
  who should have it.
- At the start of a new season, as routine hygiene.

A rotated code immediately invalidates the old one — anyone with the old code who hasn't
signed up yet will need the new one. Codes are bcrypt-hashed at rest and shown in plaintext
**exactly once**, at creation/rotation — write it down immediately.

## Seeded admin accounts

The seven hardcoded Howard NSBE officer accounts (President, Vice President, Programs Chair,
Membership Chair, Parliamentarian, Secretary, Treasurer — see `prisma/seed.ts`) are created
with a **shared initial password** (`SEED_ADMIN_PASSWORD`, or `howard1867` if unset) and
`mustChangePassword: true` — each one is forced to `/set-password` and pick their own real
password before they can reach anything else.

**Why per-person credentials matter:** once each officer sets their own password, every
`AdminLog` entry attributable to that account is attributable to *that specific person* —
"who verified this dues claim," "who deleted this registration," "who changed this role" all
resolve to one human, not "one of seven people who might have used the shared login." A
shared password that's never rotated to individual ones defeats the entire audit trail this
app is built around.

## The admin email allowlist

`Config.ADMIN_EMAIL_ALLOWLIST` (edit at `/admin/settings`) is a pipe-separated list of email
addresses exempted from the chapter's normal sign-in domain restriction
(`ALLOWED_EMAIL_DOMAIN`, e.g. `bison.howard.edu`) — it's how the seven officer accounts above,
which use personal Gmail addresses, are allowed to sign in at all.

**This is an authentication bypass list, not a role grant** — being on it doesn't make
someone an admin by itself (role is a separate `User.role` field); it only means *if* their
account exists with some role, they're allowed to sign in with an email outside the normal
domain. Keep it **short** — every address on it is one more account that isn't gated by "must
be a real chapter member's school email."

## Yearly handoff checklist

- [ ] Transfer GitHub repository access to the incoming E-Board/officers.
- [ ] Transfer hosting account ownership (Vercel or wherever it's deployed) and database
      ownership (wherever Postgres is hosted).
- [ ] Rotate the E-Board and Admin join codes (see above) — the outgoing officers' codes
      should not still work for the incoming ones to hand out.
- [ ] Confirm **at least two** ADMIN accounts exist and both people can actually sign in —
      the app itself refuses to demote the *last* admin, but it can't stop you from ending up
      with exactly one who then loses access.
- [ ] Take a season snapshot (`/admin/exports`) before anything else changes.
- [ ] Update `Config.SEASON` (see [Season rollover checklist](#season-rollover-checklist)).
- [ ] Rotate `AUTH_SECRET`/`CODE_SECRET` if there's any reason to believe they were exposed
      to someone who shouldn't have kept access (this instantly invalidates every existing
      session and every currently-displayed check-in code — don't do it mid-event).
- [ ] Update `INITIAL_ADMIN_EMAILS`/`SEED_ADMIN_PASSWORD` in the hosting environment's env
      vars if the incoming E-Board wants a documented re-seed path for themselves later.

## Known limits

- **Rate limiters are single-instance** — see [Deployment](#deployment). Fine at current
  scale; would need a shared store before running multiple app instances behind real
  adversarial traffic.
- **No fine-grained permissions** — see [Roles and permissions](#roles-and-permissions). The
  only levers are the four roles; there is no way to hand one member a narrower slice of
  E-Board's abilities.
- **`Registration` has no `orgId` column** — org-scoping goes through its `Event`/`User`
  relations. Not a practical problem at one org, but worth knowing before assuming every
  table can be filtered by `orgId` directly (see the [SQL cookbook](#sql-cookbook) queries,
  which all join through `Event`/`User` for this reason).
- **The local-disk storage/backup drivers are dev/test only** — `STORAGE_DRIVER`/
  `BACKUP_STORAGE_DRIVER` unset means files live on whatever machine is running the process,
  gitignored and not backed up themselves. A real deployment needs `vercel-blob` (uploads)
  and `s3` (backups) configured.
- **The season-snapshot workbook is not a database restore path** — it's a human-readable
  fallback. See `docs/RECOVERY.md` for exactly what reconstructing from it involves if
  Postgres itself is ever unrecoverable.

## Troubleshooting

**"Invalid URI query parameter: schema" from `pg_dump`/`psql`.** Prisma's `DATABASE_URL`
carries a `?schema=public` query param that `pg_dump`/`psql` don't understand — don't pass
`DATABASE_URL` to them directly. The backup/restore scripts already strip it
(`scripts/pg-connection.ts`); if you're running `pg_dump`/`psql` by hand, strip the query
string yourself first.

**A member says their check-in code was rejected.** Codes rotate every 60 seconds and the
verification accepts the current step *or* the immediately previous one — if it's still
failing, first check the event is actually open (`/admin` shows live status), then check
whether `/admin` is showing an "unusual check-in code activity" banner for that event (the
per-event brute-force lock pauses check-in entirely for 5 minutes and shows this same
rejection to everyone, valid code or not — an E-Board member with event access can clear it
immediately from the events board).

**A member isn't showing up on the leaderboard despite attending events.** Check
`/admin/members` filtered to them — almost always one of the two eligibility flags (dues or
National NSBE membership) is still "No" or was reported for a prior season. Their points are
still recorded (see [Stored vs. computed](#stored-vs-computed)) and will appear the moment
they report both Yes for the current season — nothing needs to be re-entered.

**Signup/signin fails with a domain error for an address that should be allowed.** Check
`Config.ALLOWED_EMAIL_DOMAIN` at `/admin/settings`, and whether the address needs to be on
`Config.ADMIN_EMAIL_ALLOWLIST` instead (see above) — the allowlist is checked only at login,
and only exempts the domain restriction, not any other requirement.

**The nightly backup didn't run, or the GitHub Action shows red.** Check the Actions tab for
`.github/workflows/backup.yml`'s run log first — the most common cause is the
`postgresql-client` apt step failing, or a wrong/expired secret among `DATABASE_URL`/
`BACKUP_S3_*`. A failed backup still writes an `AdminLog` entry (`db_backup_failed`) if it
gets far enough to reach the database at all, so `/admin/attendance`-adjacent audit queries
(query 14 above, with `target = 'db-backups'`) can confirm whether last night ran and failed
vs. never ran at all.

**"Refusing to run" from `scripts/restore-db.ts`.** This is the safety guard working as
intended, not a bug — see [Backups](#backups)/`docs/RECOVERY.md`. It needs both `--confirm`
and either a `localhost` `DATABASE_URL` or `RESTORE_ALLOW_REMOTE=true`.

---

## Discrepancies and open questions

*(Kept here rather than scattered inline, so anyone auditing this document against the code
can check every claim in one place. Three items that used to live here — no fine-grained
permission system, `.env.example` behind the shipped code, and a broken `db:migrate` — have
since been fixed; see [Roles and permissions](#roles-and-permissions) and
[Environment variables](#environment-variables) above.)*

1. **Production is not evidenced to run on Neon**, despite `docs/RECOVERY.md`'s own framing
   ("Neon's free tier has limited point-in-time recovery") suggesting it. Nothing in this
   repository — `.env`, `.env.example`, `package.json`, or any config file — references Neon;
   the local development setup is a plain Postgres instance (a Docker container, in this
   checkout). The [SQL cookbook](#sql-cookbook) and connection instructions above are written
   provider-agnostically for this reason. If production is in fact Neon, that's operational
   knowledge that lives outside this repo.
2. **Replacing or removing a resume/House-proof file never deletes the superseded
   `UploadedFile` row or its stored bytes** — `removeResume`/`setResume`/`clearHouseAssignment`
   (`src/lib/repo.ts`) only ever change which file a member's `resumeFileId`/`houseProofFileId`
   points at. This is a deliberate, documented scope boundary (see `removeResume`'s own comment)
   rather than an oversight, so it hasn't been changed — but it means every resume replacement
   or House-proof re-upload leaves the old file behind indefinitely in both the database and
   blob storage. Worth revisiting given every other data-protection concern in this app treats
   an orphaned member file as a real problem (see `scripts/clear-seed-data.ts`, which does
   delete stored bytes for every `UploadedFile` row it removes).

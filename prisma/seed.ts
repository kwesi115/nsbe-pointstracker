/**
 * Replaces the old scripts/init-workbook.ts + scripts/seed-fake-data.ts.
 * There is no legacy data to migrate — the workbook only ever held seed data.
 *
 * Idempotent: Org/PointSystem/Config upsert by their natural key, join codes
 * are created once and never silently regenerated (a plaintext code is only
 * ever shown once — see lib/repo.ts createJoinCode), the initial admin/E-Board
 * accounts upsert by (orgId, email) (an existing account's password is left
 * alone on re-run — never silently reset), and the dev fake-data block
 * upserts by (orgId, email)/(orgId, slug).
 *
 * Run with: npm run seed
 * Dev fake data too: npm run seed:fake   (sets SEED_FAKE=1)
 */

import { randomBytes } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  Audience,
  AwardKind,
  Classification as DbClassification,
  EventStatus,
  FieldType,
  FileKind,
  GroupKind,
  RegistrationSource,
  Role,
  UserStatus,
} from "../src/generated/prisma/enums";
import { generateSetupCode, hashPassword } from "../src/lib/passwords";
import { CORE_FORM_VERSION } from "../src/lib/core-form";
import { DEFAULT_HOUSES, serializeHouses } from "../src/lib/houses";
import { storage } from "../src/lib/storage";

// prisma.config.ts's own dotenv/config load only reads the root .env (for
// DATABASE_URL) and runs in the Prisma CLI's process, not this one — this
// process only inherits what that process had already resolved. Load
// .env.local here too (additively) so INITIAL_ADMIN_EMAILS is visible
// whether this runs via `npm run seed` or directly with tsx.
loadEnv({ path: ".env.local" });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

// Shared with eligibilityFor/seedFakeEboardMembers below — a member's
// membershipSeason must match this for isEligible to count them (see
// lib/points.ts). Keeping it a single constant here is what keeps the seeded
// fake data self-consistent with whatever Config.SEASON is seeded.
const SEASON = "2026-2027";

// The one chapter this deployment launches with. id/slug match deliberately:
// the hand-written migration (prisma/migrations/20260825181645_*) already
// inserted this exact row to backfill every pre-multi-tenancy table onto it —
// this upsert just makes the seed script the source of truth for a fresh DB
// too (e.g. a new dev environment that runs migrations + seed, never having
// had a single-tenant era).
const ORG_ID = "howard-nsbe";
const ORG_SLUG = "howard-nsbe";

interface HardcodedAdminSeed {
  email: string;
  eboardPosition: string;
}

/**
 * Seven standing officer accounts, seeded directly (not through self-signup
 * or INITIAL_ADMIN_EMAILS/EBOARD_EMAILS below) so every officer has their own
 * attributable login from day one — a shared password across several admins
 * would make every AdminLog entry "one of several people." Gmail addresses,
 * not @bison.howard.edu, which is why Config.ADMIN_EMAIL_ALLOWLIST (seeded in
 * seedConfig) also lists them — see lib/repo.ts isLoginEmailAllowed, the only
 * thing that exempts them from the domain check, and only at login.
 */
const HARDCODED_ADMINS: HardcodedAdminSeed[] = [
  { email: "hunsbemembership@gmail.com", eboardPosition: "Membership Chair" },
  { email: "nsbeproghu@gmail.com", eboardPosition: "Programs Chair" },
  { email: "hunsbepres@gmail.com", eboardPosition: "President" },
  { email: "nsbevphu@gmail.com", eboardPosition: "Vice President" },
  { email: "hunsbeparliamentarian@gmail.com", eboardPosition: "Parliamentarian" },
  { email: "nsbesecretaryhu@gmail.com", eboardPosition: "Secretary" },
  { email: "nsbetreashu@gmail.com", eboardPosition: "Treasurer" },
];

// ---------------------------------------------------------------------------
// Real seed — runs every time.
// ---------------------------------------------------------------------------

async function seedOrg(): Promise<string> {
  const org = await prisma.org.upsert({
    where: { slug: ORG_SLUG },
    update: {},
    create: {
      id: ORG_ID,
      slug: ORG_SLUG,
      name: "Howard University NSBE",
      shortName: "Howard NSBE",
      active: true,
    },
  });
  console.log(`Seeded Org "${org.slug}" (${org.id}).`);
  return org.id;
}

interface CategorySeed {
  code: string;
  name: string;
  shortName: string;
  tier: number | null;
  memberPoints: number;
  examples?: string;
  countsForMonthly?: boolean;
  eboardEligible?: boolean;
  audience?: Audience;
}

// Replaces the old flat PointSystem. Point values are data, never hardcoded
// anywhere else — see lib/points.ts memberPointsFor/eboardAwardFor, which
// only ever read these fields fresh at call time. EBOARD_MEETING/
// EBOARD_RETREAT score 0 member points; they're scored on the separate
// internal track instead (eboardEligible), and default to EBOARD_ONLY
// audience (see EventForm.tsx's per-category default, still overridable).
const CATEGORIES: CategorySeed[] = [
  { code: "GBM", name: "General Body Meeting", shortName: "GBM", tier: 1, memberPoints: 3, examples: "General Body Meetings" },
  {
    code: "AEX_CI",
    name: "Academic Excellence / Career Initiatives",
    shortName: "AEX/CI",
    tier: 2,
    memberPoints: 2,
    examples: "Retention Program, APEX, Graduate Student Initiative, College Initiative",
  },
  {
    code: "NLI_TD",
    name: "Leadership / Talent Development",
    shortName: "NLI/TD",
    tier: 2,
    memberPoints: 2,
    examples: "Leadership Development, Talent Development",
  },
  { code: "TORCH", name: "TORCH", shortName: "TORCH", tier: 2, memberPoints: 2, examples: "R.I.S.E., TORCH" },
  {
    code: "ED_TECH_EX",
    name: "Educational / Technical Excellence",
    shortName: "Ed/Tech Ex",
    tier: 2,
    memberPoints: 2,
    examples: "Career Pathways, Technical Training, Technical Talk",
  },
  { code: "PCI", name: "Pre-Collegiate Initiative", shortName: "PCI", tier: 2, memberPoints: 2, examples: "PCI Competition, PCI Events" },
  {
    code: "FUNCTIONAL",
    name: "Functional / Social",
    shortName: "Functional",
    tier: 3,
    memberPoints: 1,
    examples: "Mixers/Socials, Fundraisers, Other General Chapter Events",
  },
  { code: "NSBE_WEEK", name: "NSBE Week", shortName: "NSBE Week", tier: null, memberPoints: 2, countsForMonthly: true },
  {
    code: "EBOARD_MEETING",
    name: "E-Board Meeting",
    shortName: "E-Board Mtg",
    tier: null,
    memberPoints: 0,
    eboardEligible: true,
    audience: Audience.EBOARD_ONLY,
  },
  {
    code: "EBOARD_RETREAT",
    name: "Retreat",
    shortName: "Retreat",
    tier: null,
    memberPoints: 0,
    eboardEligible: true,
    audience: Audience.EBOARD_ONLY,
  },
];

async function seedCategories(orgId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const [i, c] of CATEGORIES.entries()) {
    const data = {
      name: c.name,
      shortName: c.shortName,
      tier: c.tier,
      memberPoints: c.memberPoints,
      examples: c.examples ?? null,
      countsForMonthly: c.countsForMonthly ?? true,
      eboardEligible: c.eboardEligible ?? true,
      audience: c.audience ?? Audience.ALL,
      sortOrder: i,
    };
    const row = await prisma.eventCategory.upsert({
      where: { orgId_code: { orgId, code: c.code } },
      update: data,
      create: { orgId, code: c.code, ...data },
    });
    ids.set(c.code, row.id);
  }
  console.log(`Seeded EventCategory (${CATEGORIES.length} categories).`);
  return ids;
}

async function seedConfig(orgId: string) {
  const config: Record<string, string> = {
    SEASON,
    CHAPTER_NAME: "Howard University Chapter",
    ALLOWED_EMAIL_DOMAIN: "bison.howard.edu",
    // Login-only exemption for the seven hardcoded officer accounts below
    // (see lib/repo.ts isLoginEmailAllowed) — never touched again after first
    // seed (update: {} in the loop below), so an admin's edit at
    // /admin/settings survives every future reseed.
    ADMIN_EMAIL_ALLOWLIST: HARDCODED_ADMINS.map((a) => a.email).join("|"),
    LEADERBOARD_SHOW_FULL_NAMES: "false",
    CORE_FORM_VERSION: String(CORE_FORM_VERSION),
    MAJORS_LIST: MAJORS.join("|"),
    HOUSES_LIST: serializeHouses(DEFAULT_HOUSES),
    MEMBERSHIP_SITE_URL: "https://howardnsbe.org/membership",
    HOUSE_TEST_URL: "https://forms.gle/nsbe-house-personality-test",
    // Kept in sync with lib/repo.ts DEFAULT_NATIONAL_MEMBERSHIP_URL — same
    // reason as LEADERBOARD_DISCLAIMER below, not imported directly.
    NATIONAL_MEMBERSHIP_URL: "https://nsbe.org/memberships/",
    SHOW_PENDING_POINTS: "false",
    MAX_EXTRA_QUESTIONS: "5",
    // Kept in sync with lib/repo.ts DEFAULT_LEADERBOARD_DISCLAIMER — not
    // imported directly to avoid pulling that module's own Prisma singleton
    // into this script's separate PrismaPg-adapter client.
    LEADERBOARD_DISCLAIMER:
      "Leaderboard standing does not guarantee selection for conferences, but it plays a significant role in the selection process.",
    // The registration window is no longer the sole gate (a rotating
    // check-in code is) — 20 minutes gives a GBM room to open the code,
    // announce it, and let people trickle in.
    DEFAULT_EVENT_DURATION: "20",
    EBOARD_POINT_VALUE: "1",
    EBOARD_TRACK_ENABLED: "true",
    EBOARD_REQUIRES_MEMBERSHIP: "false",
    MONTHLY_CHAMPION_MIN_EVENTS: "2",
    // Per-EVENT check-in code brute-force thresholds (see lib/rate-limit.ts
    // recordEventCodeFailure) — counts FAILED verifications across every
    // member/guest/IP for one event within a 10-minute window. Distinct from
    // the existing per-member/IP limiter, which a distributed attacker
    // (many accounts) isn't slowed by on its own.
    EVENT_CODE_FAIL_SOFT: "100",
    EVENT_CODE_FAIL_HARD: "250",
  };

  for (const [key, value] of Object.entries(config)) {
    await prisma.config.upsert({ where: { orgId_key: { orgId, key } }, update: {}, create: { orgId, key, value } });
  }
  console.log("Seeded Config.");
}

/**
 * The whole signup security model now lives here (Part 3) — one active code
 * per role, bcrypt-hashed, plaintext shown ONLY in this console output.
 * Idempotent by (orgId, label): if a code with this label already exists
 * (active or not), it's left alone — re-running seed must never regenerate or
 * re-reveal a code that's already in members' hands. Use /admin/join-codes to
 * rotate one instead.
 *
 * No GENERAL entry: general membership needs no code at all now (the email
 * domain check is the only gate — see /join's createAccountAction). EBOARD
 * and ADMIN still require a code that grants that specific role; GUEST still
 * has its own separate-purpose pass at /guest/join.
 */
const JOIN_CODES: Array<{ label: string; grantsRole: Role }> = [
  { label: "E-Board code", grantsRole: Role.EBOARD },
  { label: "Admin code", grantsRole: Role.ADMIN },
  { label: "Guest pass code", grantsRole: Role.GUEST },
];

const RETIRED_LABELS = ["General member code"];

function hintFor(plaintext: string): string {
  return `${plaintext.slice(0, 2).toUpperCase()}••••`;
}

async function seedJoinCodes(orgId: string) {
  const retired = await prisma.joinCode.updateMany({
    where: { orgId, label: { in: RETIRED_LABELS }, active: true },
    data: { active: false },
  });
  if (retired.count > 0) {
    console.log(`Deactivated ${retired.count} retired join code(s) (general membership needs no code now).`);
  }

  const printed: string[] = [];
  for (const { label, grantsRole } of JOIN_CODES) {
    const existing = await prisma.joinCode.findFirst({ where: { orgId, label } });
    if (existing) {
      console.log(`Join code "${label}" already exists — left as-is (rotate it from /admin/join-codes if needed).`);
      continue;
    }
    const plaintext = generateSetupCode();
    const hash = await hashPassword(plaintext);
    await prisma.joinCode.create({
      data: { orgId, code: hash, codeHint: hintFor(plaintext), grantsRole, label },
    });
    printed.push(`  ${label.padEnd(24)} [${grantsRole}]  ${plaintext}`);
  }
  if (printed.length > 0) {
    console.log("\nNew join codes (shown once — write these down now):");
    for (const line of printed) console.log(line);
    console.log("");
  }
}

async function seedInitialAdmins(orgId: string) {
  const raw = process.env.INITIAL_ADMIN_EMAILS ?? "";
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    console.log("INITIAL_ADMIN_EMAILS is empty — no Admin accounts seeded.");
    return;
  }

  for (const email of emails) {
    const existing = await prisma.user.findUnique({ where: { orgId_email: { orgId, email } } });
    if (existing) {
      console.log(`Admin account already exists for ${email} — password left unchanged.`);
      continue;
    }

    const password = randomBytes(9).toString("base64url");
    const passwordHash = await hashPassword(password);
    const [firstName, ...rest] = email.split("@")[0].split(/[._-]/);
    await prisma.user.create({
      data: {
        orgId,
        email,
        passwordHash,
        // No manufactured surname when the email's local part has nothing to
        // split (e.g. "kwesimichai1@gmail.com") — leave lastName blank and let
        // display code fall back to the email local part (see memberDisplayName).
        firstName: capitalize(firstName || email.split("@")[0]),
        lastName: capitalize(rest.join(" ")),
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
      },
    });
    console.log(`Created Admin account ${email} — password: ${password}`);
  }
}

/**
 * The seven Howard NSBE officer accounts (see HARDCODED_ADMINS above).
 * Idempotent, keyed on (orgId, email):
 *   - account absent  -> create it: ADMIN, ACTIVE, mustChangePassword=true,
 *     passwordHash = bcrypt(SEED_ADMIN_PASSWORD ?? "howard1867"). firstName is
 *     the position (so the roster shows something readable before the
 *     officer sets their real name); lastName is blank.
 *   - account exists  -> refresh role/eboardPosition only. passwordHash and
 *     mustChangePassword are NEVER touched here — an officer who has already
 *     set a real password must not have it silently reset back to the seed
 *     default on the next `prisma db seed`.
 * The plaintext default password is only ever printed for an account
 * actually created this run — an already-existing account's password is
 * unknown to this script (and stays that way).
 */
async function seedHardcodedAdmins(orgId: string): Promise<void> {
  const password = process.env.SEED_ADMIN_PASSWORD ?? "howard1867";
  // Hashed once up front, and only actually used if at least one account
  // needs creating below — cost-12 bcrypt isn't free.
  const passwordHash = await hashPassword(password);

  const created: string[] = [];
  const skipped: string[] = [];

  for (const { email, eboardPosition } of HARDCODED_ADMINS) {
    const existing = await prisma.user.findUnique({ where: { orgId_email: { orgId, email } } });
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: { role: Role.ADMIN, eboardPosition } });
      skipped.push(email);
      continue;
    }

    const user = await prisma.user.create({
      data: {
        orgId,
        email,
        passwordHash,
        firstName: eboardPosition,
        lastName: "",
        role: Role.ADMIN,
        status: UserStatus.ACTIVE,
        mustChangePassword: true,
        eboardPosition,
      },
    });
    // actorId is intentionally null — there's no human actor for a seed run,
    // same convention as the "guest" actor string elsewhere in lib/repo.ts
    // logAdminAction (an email that matches no User resolves to a null actor).
    await prisma.adminLog.create({
      data: { orgId, actorId: null, action: "seed_admin_account", target: user.email, detail: eboardPosition },
    });
    created.push(email);
  }

  console.log(`\nHoward NSBE officer accounts: ${created.length} created, ${skipped.length} already existed (role/position refreshed, password left alone).`);
  if (skipped.length > 0) {
    for (const email of skipped) console.log(`  already existed: ${email}`);
  }
  if (created.length > 0) {
    for (const email of created) console.log(`  created: ${email}`);
    console.log(`  Default password for newly created accounts: ${password}`);
    console.log("  Each must change their password at first login (mustChangePassword is set) before reaching /admin.");
  }
}

/**
 * Standing roster of officer emails — separate from INITIAL_ADMIN_EMAILS
 * (a one-time bootstrap for specific known admin accounts). An existing user
 * is promoted directly (idempotent, no AdminLog — there's no human actor for
 * a seed run); an address that hasn't signed up yet gets an unclaimed
 * placeholder (PENDING, mustChangePassword true, unusable random password)
 * that an admin can reset from /admin/members once they do.
 */
async function seedEboardEmails(orgId: string) {
  const raw = process.env.EBOARD_EMAILS ?? "";
  const emails = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) {
    console.log("EBOARD_EMAILS is empty — no officer roster seeded.");
    return;
  }

  let promoted = 0;
  let placeholders = 0;
  for (const email of emails) {
    const existing = await prisma.user.findUnique({ where: { orgId_email: { orgId, email } } });
    if (existing) {
      if (existing.role !== Role.EBOARD && existing.role !== Role.ADMIN) {
        await prisma.user.update({ where: { id: existing.id }, data: { role: Role.EBOARD } });
        promoted++;
      }
      continue;
    }

    const passwordHash = await hashPassword(generateSetupCode());
    const [firstName, ...rest] = email.split("@")[0].split(/[._-]/);
    await prisma.user.create({
      data: {
        orgId,
        email,
        passwordHash,
        firstName: capitalize(firstName || "Officer"),
        lastName: capitalize(rest.join(" ")) || "TBD",
        role: Role.EBOARD,
        status: UserStatus.PENDING,
        mustChangePassword: true,
      },
    });
    placeholders++;
  }
  console.log(`EBOARD_EMAILS: ${promoted} promoted to EBOARD, ${placeholders} placeholder(s) awaiting setup.`);
}

// ---------------------------------------------------------------------------
// Dev-only fake data — behind SEED_FAKE, never runs in production seeding.
// ---------------------------------------------------------------------------

const FAKE_DEV_PASSWORD = "chapter-dev-password";

const FIRST_NAMES = [
  "Amara", "Jalen", "Zora", "Marcus", "Nia", "Devon", "Simone", "Elijah", "Kayla", "Isaiah",
  "Aaliyah", "Xavier", "Imani", "Malik", "Jada", "Andre", "Destiny", "Jamal", "Alicia", "Terrence",
  "Chidi", "Brianna", "Kwame", "Maya", "Darius", "Ebony", "Cameron", "Sydney", "Trevor", "Angela",
  "Amir", "Jasmine", "Kobe", "Layla", "Femi", "Ashanti", "Miles", "Toni", "Julian", "Nadia",
];
const LAST_NAMES = [
  "Johnson", "Williams", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas",
  "Jackson", "White", "Harris", "Martin", "Thompson", "Robinson", "Clark", "Lewis", "Walker", "Hall",
  "Allen", "Young", "King", "Wright", "Scott", "Green", "Baker", "Adams", "Nelson", "Carter",
  "Mitchell", "Perez", "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins",
];
const MAJORS = [
  "Electrical Engineering", "Computer Science", "Mechanical Engineering", "Civil Engineering",
  "Chemical Engineering", "Computer Engineering", "Systems & Computer Science", "Architecture",
];
const CLASSIFICATION_ENUMS = [
  DbClassification.FRESHMAN,
  DbClassification.SOPHOMORE,
  DbClassification.JUNIOR,
  DbClassification.SENIOR,
  DbClassification.GRADUATE,
];
// The four real NSBE Houses (see lib/houses.ts DEFAULT_HOUSES) — fake members are distributed across all of them.
const HOUSE_NAMES = DEFAULT_HOUSES.map((h) => h.name);
const MEMBERSHIPS = ["General Member", "General Member", "General Member", "Life Member"];

// One event per non-E-Board/non-NSBE-Week category, so every tier/point
// value is reviewable on first boot without any manual setup.
const EVENT_TEMPLATES: Array<{ name: string; categoryCode: string; daysAgo: number }> = [
  { name: "September GBM", categoryCode: "GBM", daysAgo: 150 },
  { name: "Resume Workshop", categoryCode: "ED_TECH_EX", daysAgo: 130 },
  { name: "APEX Info Session", categoryCode: "AEX_CI", daysAgo: 110 },
  { name: "Leadership Talk", categoryCode: "NLI_TD", daysAgo: 90 },
  { name: "PCI Kickoff", categoryCode: "PCI", daysAgo: 75 },
  { name: "TORCH Info Session", categoryCode: "TORCH", daysAgo: 60 },
  { name: "Winter Social", categoryCode: "FUNCTIONAL", daysAgo: 30 },
];

const FORM_FIELDS: Array<{ fieldKey: string; label: string; type: FieldType; required: boolean; options: string[] }> = [
  { fieldKey: "how_did_you_hear", label: "How did you hear about this event?", type: FieldType.SELECT, required: true, options: ["GroupMe", "Email", "Friend", "Instagram"] },
  { fieldKey: "feedback", label: "Any feedback?", type: FieldType.LONG_TEXT, required: false, options: [] },
];

function pick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Four even eligibility groups (10 each) so /admin/verifications and every
 * dashboard state are reviewable on first boot without any manual setup —
 * see Part 9 of the plan. i 0-9 fully verified, 10-19 dues only, 20-29
 * national only, 30-39 neither.
 */
function eligibilityFor(i: number): {
  duesPaidReported: boolean;
  duesReportedAt: Date | null;
  duesVerifiedAt: Date | null;
  nationalMemberReported: boolean;
  nationalVerifiedAt: Date | null;
  membershipSeason: string | null;
} {
  const group = Math.floor(i / 10);
  const now = new Date();
  const duesOk = group === 0 || group === 1;
  const nationalOk = group === 0 || group === 2;

  // Within the "neither" group (30-39), a few are genuinely pending review
  // (self-reported, not yet verified) rather than never having claimed
  // anything — otherwise /admin/verifications' Dues/National tabs would have
  // nothing to demo even though the four dashboard states are all present.
  const duesPending = group === 3 && i % 10 < 4;
  const nationalPending = group === 3 && i % 10 >= 4 && i % 10 < 8;
  const duesReported = duesOk || duesPending;
  const nationalReported = nationalOk || nationalPending;

  return {
    duesPaidReported: duesReported,
    duesReportedAt: duesReported ? now : null,
    duesVerifiedAt: duesOk ? now : null,
    nationalMemberReported: nationalReported,
    nationalVerifiedAt: nationalOk ? now : null,
    // Self-reported eligibility (Part 1) — stamped whenever either flag is
    // true, same rule lib/repo.ts setDuesReported/setNationalReported apply.
    // Only "group 0" (both true) actually clears isEligible's season check;
    // groups 1/2/3 still fail on the other missing flag regardless.
    membershipSeason: duesReported || nationalReported ? SEASON : null,
  };
}

/** A 1x1 PNG — just enough real bytes for file-type sniffing and an <img> tag to render something. */
const PLACEHOLDER_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function seedFakeMembers(orgId: string): Promise<string[]> {
  const passwordHash = await hashPassword(FAKE_DEV_PASSWORD);
  const emails: string[] = [];

  for (let i = 0; i < 40; i++) {
    const firstName = FIRST_NAMES[i % FIRST_NAMES.length];
    const lastName = LAST_NAMES[(i * 7) % LAST_NAMES.length];
    const email = `${slugify(firstName)}.${slugify(lastName)}${i}@bison.howard.edu`;
    emails.push(email);

    // A handful of verified Houses (i 0-4), spread across all four real
    // Houses, plus one specific pending House-proof review case (i 5) with a
    // real uploaded file so the admin queue has something to actually
    // render — everyone else has no House yet.
    const house = i < 5 ? HOUSE_NAMES[i % HOUSE_NAMES.length] : i === 5 ? HOUSE_NAMES[0] : null;
    const houseVerifiedAt = i < 5 ? new Date() : null;

    // Unlike admin accounts (never clobbered on re-run — see seedInitialAdmins),
    // these are synthetic dev data with nothing real to protect, so every
    // field is refreshed on every run — otherwise re-running seed:fake after
    // this eligibility/House logic changes would silently do nothing for
    // anyone already seeded by an older version of this script.
    const fields = {
      firstName,
      lastName,
      studentId: String(1000000 + i),
      classification: CLASSIFICATION_ENUMS[i % CLASSIFICATION_ENUMS.length],
      major: MAJORS[i % MAJORS.length],
      membership: MEMBERSHIPS[i % MEMBERSHIPS.length],
      house,
      houseVerifiedAt,
      role: Role.GENERAL,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
      ...eligibilityFor(i),
    };

    const user = await prisma.user.upsert({
      where: { orgId_email: { orgId, email } },
      update: fields,
      create: { orgId, email, passwordHash, ...fields },
    });

    if (i === 5 && !user.houseProofFileId) {
      const stored = await storage.put({ buffer: PLACEHOLDER_PNG, kind: "house_proof", extension: ".png" });
      const file = await prisma.uploadedFile.create({
        data: {
          orgId,
          userId: user.id,
          kind: FileKind.HOUSE_PROOF,
          storageKey: stored.storageKey,
          originalName: "house-test-result.png",
          mimeType: "image/png",
          sizeBytes: PLACEHOLDER_PNG.byteLength,
        },
      });
      await prisma.user.update({ where: { id: user.id }, data: { houseProofFileId: file.id } });
    }
  }

  console.log(`Seeded ${emails.length} fake GENERAL members (dev password: ${FAKE_DEV_PASSWORD}).`);
  console.log(
    "  10 fully verified, 10 dues-only, 10 national-only, 4 dues pending, 4 national pending, 2 neither — see /admin/verifications.",
  );
  return emails;
}

/**
 * Three officers with distinct positions and dev password, so
 * /admin/leaderboard and the EBOARD dashboard view have real data to show on
 * first boot. Deliberately not repurposing any of the 40 GENERAL fixtures —
 * those indices are already load-bearing for the eligibility/House demo
 * states above.
 */
async function seedFakeEboardMembers(orgId: string): Promise<string[]> {
  const passwordHash = await hashPassword(FAKE_DEV_PASSWORD);
  const OFFICERS = [
    { firstName: "Morgan", lastName: "Price", position: "President" },
    { firstName: "Reese", lastName: "Okafor", position: "Programs Chair" },
    { firstName: "Sasha", lastName: "Delgado", position: "Treasurer" },
  ];
  const emails: string[] = [];
  const now = new Date();

  for (const officer of OFFICERS) {
    const email = `${slugify(officer.firstName)}.${slugify(officer.lastName)}@bison.howard.edu`;
    emails.push(email);
    await prisma.user.upsert({
      where: { orgId_email: { orgId, email } },
      update: {
        firstName: officer.firstName,
        lastName: officer.lastName,
        eboardPosition: officer.position,
        role: Role.EBOARD,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
      },
      create: {
        orgId,
        email,
        passwordHash,
        firstName: officer.firstName,
        lastName: officer.lastName,
        eboardPosition: officer.position,
        classification: DbClassification.SENIOR,
        major: MAJORS[0],
        role: Role.EBOARD,
        status: UserStatus.ACTIVE,
        mustChangePassword: false,
        duesPaidReported: true,
        duesVerifiedAt: now,
        nationalMemberReported: true,
        nationalVerifiedAt: now,
        membershipSeason: SEASON,
      },
    });
  }

  console.log(`Seeded ${emails.length} fake EBOARD members (dev password: ${FAKE_DEV_PASSWORD}) — see /admin/leaderboard.`);
  return emails;
}

/** NSBE Week 2026 — a sample event group with 5 events, all closed in the past so the group's completion bonus is already reviewable on first boot (see lib/points.ts groupBonusFor). */
async function seedNsbeWeekGroup(orgId: string, categoryIds: Map<string, string>): Promise<string[]> {
  const now = Date.now();
  const group = await prisma.eventGroup.upsert({
    where: { orgId_slug: { orgId, slug: "nsbe-week-2026" } },
    update: {},
    create: {
      orgId,
      name: "NSBE Week 2026",
      slug: "nsbe-week-2026",
      kind: GroupKind.NSBE_WEEK,
      expectedEventCount: 5,
      bonusTiers: [
        { min: 3, max: 4, bonus: 3 },
        { min: 5, max: null, bonus: 5 },
      ],
    },
  });

  const eventIds: string[] = [];
  for (let day = 1; day <= 5; day++) {
    const date = new Date(now - (45 - day) * 86_400_000); // 5 consecutive days, well in the past
    const slug = `nsbe-week-2026-day-${day}`;
    const event = await prisma.event.upsert({
      where: { orgId_slug: { orgId, slug } },
      update: { groupId: group.id },
      create: {
        orgId,
        slug,
        name: `NSBE Week — Day ${day}`,
        categoryId: categoryIds.get("NSBE_WEEK")!,
        groupId: group.id,
        date,
        location: "Howard University",
        description: `NSBE Week 2026, Day ${day} — seeded dev event.`,
        status: EventStatus.SCHEDULED,
        opensAt: date,
        closesAt: new Date(date.getTime() + 60 * 60_000),
        durationMinutes: 60,
      },
    });
    eventIds.push(event.id);
  }
  console.log("Seeded NSBE Week 2026 group (5 events).");
  return eventIds;
}

async function seedFakeEvents(
  orgId: string,
  categoryIds: Map<string, string>,
): Promise<{ pastEventIds: string[]; eboardOnlyEventIds: string[]; nsbeWeekEventIds: string[] }> {
  const now = Date.now();
  const pastEventIds: string[] = [];

  for (const template of EVENT_TEMPLATES) {
    const date = new Date(now - template.daysAgo * 86_400_000);
    const slug = `${slugify(template.name)}-${date.getFullYear()}`;

    const event = await prisma.event.upsert({
      where: { orgId_slug: { orgId, slug } },
      update: {},
      create: {
        orgId,
        slug,
        name: template.name,
        categoryId: categoryIds.get(template.categoryCode)!,
        date,
        location: "Howard University",
        description: `${template.name} — seeded dev event.`,
        status: EventStatus.SCHEDULED,
        opensAt: date,
        closesAt: new Date(date.getTime() + 60 * 60_000),
        durationMinutes: 60,
      },
    });
    pastEventIds.push(event.id);

    for (const [i, field] of FORM_FIELDS.entries()) {
      await prisma.formField.upsert({
        where: { eventId_fieldKey: { eventId: event.id, fieldKey: field.fieldKey } },
        update: {},
        create: { eventId: event.id, order: i, ...field },
      });
    }
  }

  const nsbeWeekEventIds = await seedNsbeWeekGroup(orgId, categoryIds);

  // EBOARD_ONLY events — weekly-style meetings plus one retreat, so the
  // internal leaderboard's category breakdown and attendance rate have
  // enough data points to actually mean something (Part 4).
  const eboardOnlyEventIds: string[] = [];
  const EBOARD_TEMPLATES: Array<{ name: string; categoryCode: string; daysAgo: number }> = [
    { name: "Week 1 E-Board Meeting", categoryCode: "EBOARD_MEETING", daysAgo: 28 },
    { name: "Week 2 E-Board Meeting", categoryCode: "EBOARD_MEETING", daysAgo: 21 },
    { name: "Week 3 E-Board Meeting", categoryCode: "EBOARD_MEETING", daysAgo: 14 },
    { name: "Week 4 E-Board Meeting", categoryCode: "EBOARD_MEETING", daysAgo: 7 },
    { name: "Fall Retreat", categoryCode: "EBOARD_RETREAT", daysAgo: 100 },
  ];
  for (const template of EBOARD_TEMPLATES) {
    const date = new Date(now - template.daysAgo * 86_400_000);
    const slug = `${slugify(template.name)}-${date.getFullYear()}`;
    const event = await prisma.event.upsert({
      where: { orgId_slug: { orgId, slug } },
      update: {},
      create: {
        orgId,
        slug,
        name: template.name,
        categoryId: categoryIds.get(template.categoryCode)!,
        date,
        location: "Howard University",
        description: `${template.name} — seeded dev event.`,
        status: EventStatus.SCHEDULED,
        opensAt: date,
        closesAt: new Date(date.getTime() + 60 * 60_000),
        durationMinutes: 60,
        audience: Audience.EBOARD_ONLY,
      },
    });
    eboardOnlyEventIds.push(event.id);
  }

  // 1 SCHEDULED event in the future.
  const futureDate = new Date(now + 14 * 86_400_000);
  await prisma.event.upsert({
    where: { orgId_slug: { orgId, slug: `spring-gbm-${futureDate.getFullYear()}` } },
    update: {},
    create: {
      orgId,
      slug: `spring-gbm-${futureDate.getFullYear()}`,
      name: "Spring GBM",
      categoryId: categoryIds.get("GBM")!,
      date: futureDate,
      location: "Howard University",
      description: "Next general body meeting — seeded dev event.",
      status: EventStatus.SCHEDULED,
      opensAt: futureDate,
      closesAt: new Date(futureDate.getTime() + 60 * 60_000),
      durationMinutes: 60,
    },
  });

  // 1 currently OPEN event — testable the moment the app boots.
  await prisma.event.upsert({
    where: { orgId_slug: { orgId, slug: "live-demo-checkin" } },
    update: {
      opensAt: new Date(now - 5 * 60_000),
      closesAt: new Date(now + 15 * 60_000),
      status: EventStatus.SCHEDULED,
    },
    create: {
      orgId,
      slug: "live-demo-checkin",
      name: "Live Demo Check-In",
      categoryId: categoryIds.get("FUNCTIONAL")!,
      date: new Date(now),
      location: "Howard University",
      description: "Always-open dev event for exercising the check-in flow.",
      status: EventStatus.SCHEDULED,
      opensAt: new Date(now - 5 * 60_000),
      closesAt: new Date(now + 15 * 60_000),
      durationMinutes: 20,
    },
  });

  console.log(
    `Seeded ${EVENT_TEMPLATES.length} past events, ${EBOARD_TEMPLATES.length} E-Board-only, 1 scheduled, 1 open.`,
  );
  return { pastEventIds, eboardOnlyEventIds, nsbeWeekEventIds };
}

/**
 * Registers each fake member for a random subset of the events they're
 * actually allowed to see — GENERAL members never get an EBOARD_ONLY event
 * (mirrors the real FORBIDDEN check in registerForEvent), EBOARD members see
 * everything. pointsAwarded/snapshot columns mirror what registerForEvent
 * would actually produce: 0 member points for anyone not GENERAL, and null
 * classification/major/dues/national snapshot fields for an EBOARD_ONLY
 * (reduced-form) registration.
 */
async function seedFakeRegistrations(
  orgId: string,
  generalEmails: string[],
  eboardEmails: string[],
  pastEventIds: string[],
  eboardOnlyEventIds: string[],
  nsbeWeekEventIds: string[],
) {
  const users = await prisma.user.findMany({ where: { orgId, email: { in: [...generalEmails, ...eboardEmails] } } });
  const categories = await prisma.eventCategory.findMany({ where: { orgId } });
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  // NSBE Week's 5 events are in this same ALL-audience pool so each fake
  // member's random subset naturally produces a spread of 0-5 attended —
  // real variety across the group's bonus tiers to review at /admin/groups.
  const chapterEvents = await prisma.event.findMany({ where: { id: { in: [...pastEventIds, ...nsbeWeekEventIds] } } });
  const eboardOnlyEvents = await prisma.event.findMany({ where: { id: { in: eboardOnlyEventIds } } });
  const eboardOnlyIds = new Set(eboardOnlyEventIds);

  let created = 0;
  for (const user of users) {
    const isEboard = user.role === Role.EBOARD;
    // Each fake member attends a random subset of the events they can see —
    // overlapping subsets naturally produce point ties on both boards.
    const visibleEvents = isEboard ? [...chapterEvents, ...eboardOnlyEvents] : chapterEvents;
    const attended = pick(visibleEvents, 1 + Math.floor(Math.random() * visibleEvents.length));
    for (const event of attended) {
      const existing = await prisma.registration.findUnique({
        where: { eventId_userId: { eventId: event.id, userId: user.id } },
      });
      if (existing) continue;

      const isReducedForm = eboardOnlyIds.has(event.id);
      const category = categoryById.get(event.categoryId);
      // Mirrors lib/points.ts memberPointsFor: override wins, else the category's current value.
      const points = user.role === Role.GENERAL ? (event.pointsOverride ?? category?.memberPoints ?? 0) : 0;
      // Mirrors lib/points.ts isEligible — self-reported + matching season, not admin verification.
      const eligibleAtTime = isReducedForm
        ? null
        : user.duesPaidReported === true && user.nationalMemberReported === true && user.membershipSeason === SEASON;
      const registration = await prisma.registration.create({
        data: {
          eventId: event.id,
          userId: user.id,
          pointsAwarded: points,
          roleAtTime: user.role,
          source: RegistrationSource.FORM,
          createdAt: event.date,
          classificationAtTime: isReducedForm ? null : user.classification,
          majorAtTime: isReducedForm ? null : user.major,
          duesReportedAtTime: isReducedForm ? null : user.duesPaidReported,
          nationalReportedAtTime: isReducedForm ? null : user.nationalMemberReported,
          coreFormVersion: CORE_FORM_VERSION,
          eligibleAtTime,
        },
      });
      if (!isReducedForm) {
        await prisma.answer.createMany({
          data: [
            { registrationId: registration.id, fieldKey: "how_did_you_hear", value: randomOf(["GroupMe", "Email", "Friend", "Instagram"]) },
            { registrationId: registration.id, fieldKey: "feedback", value: "" },
          ],
        });
      }
      created++;
    }
  }
  console.log(`Seeded ${created} fake registrations with answers.`);
}

/** One ADMIN fixture so /admin/join-codes and /admin/members are reachable in dev without relying on INITIAL_ADMIN_EMAILS. */
async function seedFakeAdmin(orgId: string): Promise<void> {
  const passwordHash = await hashPassword(FAKE_DEV_PASSWORD);
  const email = "admin.demo@bison.howard.edu";
  await prisma.user.upsert({
    where: { orgId_email: { orgId, email } },
    update: { role: Role.ADMIN, status: UserStatus.ACTIVE, mustChangePassword: false },
    create: {
      orgId,
      email,
      passwordHash,
      firstName: "Admin",
      lastName: "Demo",
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      mustChangePassword: false,
    },
  });
  console.log(`Seeded fake ADMIN account ${email} (dev password: ${FAKE_DEV_PASSWORD}).`);
}

function formatMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** A couple of game bonuses plus one already-materialized monthly champion (Part 6) — so /admin/awards has real, reviewable data on first boot without anyone having to click "Calculate" first. */
async function seedBonusAwards(orgId: string, generalEmails: string[], pastEventIds: string[]): Promise<void> {
  if (pastEventIds.length === 0) return;
  const users = await prisma.user.findMany({ where: { orgId, email: { in: generalEmails.slice(0, 3) } } });
  if (users.length < 2) return;

  const gameEventId = pastEventIds[0];
  for (const user of users.slice(0, 2)) {
    await prisma.pointAward.upsert({
      where: { orgId_userId_kind_eventId: { orgId, userId: user.id, kind: AwardKind.GAME_COMPETITION, eventId: gameEventId } },
      update: {},
      create: {
        orgId,
        userId: user.id,
        kind: AwardKind.GAME_COMPETITION,
        points: 1,
        eventId: gameEventId,
        reason: "Chapter trivia night winner",
      },
    });
  }

  // Two full months ago — safely a "closed" month regardless of when seed runs.
  const championMonth = formatMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1));
  const champion = users[0];
  await prisma.pointAward.upsert({
    where: {
      orgId_userId_kind_periodMonth: { orgId, userId: champion.id, kind: AwardKind.MONTHLY_CHAMPION, periodMonth: championMonth },
    },
    update: {},
    create: {
      orgId,
      userId: champion.id,
      kind: AwardKind.MONTHLY_CHAMPION,
      points: 5,
      periodMonth: championMonth,
      reason: `Monthly Engagement Champion — ${championMonth} (seeded)`,
    },
  });
  console.log("Seeded 2 game bonuses and 1 materialized monthly champion.");
}

async function seedFakeData(orgId: string, categoryIds: Map<string, string>) {
  const generalEmails = await seedFakeMembers(orgId);
  const eboardEmails = await seedFakeEboardMembers(orgId);
  await seedFakeAdmin(orgId);
  const { pastEventIds, eboardOnlyEventIds, nsbeWeekEventIds } = await seedFakeEvents(orgId, categoryIds);
  await seedFakeRegistrations(orgId, generalEmails, eboardEmails, pastEventIds, eboardOnlyEventIds, nsbeWeekEventIds);
  await seedBonusAwards(orgId, generalEmails, pastEventIds);
}

async function main() {
  const orgId = await seedOrg();
  const categoryIds = await seedCategories(orgId);
  await seedConfig(orgId);
  await seedJoinCodes(orgId);
  await seedHardcodedAdmins(orgId);
  await seedInitialAdmins(orgId);
  await seedEboardEmails(orgId);

  if (process.env.SEED_FAKE) {
    console.log("\nSEED_FAKE set — seeding dev fake data...");
    await seedFakeData(orgId, categoryIds);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

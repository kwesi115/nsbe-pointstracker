/**
 * Typed accessors over Postgres (via Prisma). This is the ONLY module the
 * rest of the app should import for data access — it returns domain types
 * (lib/types.ts), never raw Prisma rows, and maps Prisma's enums to/from the
 * lowercase domain enums at this boundary so lib/points.ts, lib/code.ts, and
 * lib/forms.ts never see a Prisma type.
 *
 * Multi-tenancy: every exported function below that touches an org-scoped
 * model (User, Event, EventCategory, EventGroup, PointAward, Config, AdminLog, UploadedFile, JoinCode)
 * takes `orgId` as a required, non-defaulted first parameter — there is no
 * fallback org, so a call site that doesn't have one is a compile error, not
 * a silent cross-org query. Functions keyed by an id on a model that has no
 * orgId column of its own (FormField, Registration, Answer) still take
 * orgId and filter through the owning Event's `orgId` relation in the same
 * query, so a caller can never read/write another org's rows by guessing an
 * id. The only functions exempt from this are pure predicates/helpers with no
 * database access (canAccessFile, slugify) and org-lookup functions
 * (getOrgBySlug, getActiveOrgs) — those two are how a caller gets an orgId in
 * the first place, so they can't require one themselves.
 */

import { revalidateTag } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import {
  Audience as DbAudience,
  AwardKind as DbAwardKind,
  Classification as DbClassification,
  FieldType as DbFieldType,
  EventStatus as DbEventStatus,
  FileKind as DbFileKind,
  GroupKind as DbGroupKind,
  RegistrationSource as DbSource,
  Role as DbRole,
  ShirtSize as DbShirtSize,
  UserStatus as DbUserStatus,
} from "@/generated/prisma/enums";
import type {
  AdminLogModel,
  EventCategoryModel,
  EventGroupModel,
  EventModel,
  FormFieldModel,
  JoinCodeModel,
  OrgModel,
  PointAwardModel,
  RegistrationModel,
  UploadedFileModel,
  UserModel,
} from "@/generated/prisma/models";
import { verifyCode } from "./code";
import { AppError } from "./errors";
import { CORE_FORM_VERSION, getMissingFields, validateCoreAnswers, validateReducedCoreAnswers } from "./core-form";
import { validateAnswers, serializeAnswers } from "./forms";
import { parseHouses, type House } from "./houses";
import { generateSetupCode, hashPassword, verifyPassword } from "./passwords";
import { hashIp, isEventCodeLocked, recordEventCodeFailure } from "./rate-limit";
import {
  computeEboardStandings,
  computeStandings,
  computeStandingsWithBreakdowns,
  eboardAwardFor,
  groupBonusFor,
  isEligible,
  isGroupComplete,
  isOpen,
  memberPointsFor,
  memberTotal,
  monthlyChampions,
  rankWithLiveSelf,
  standingsCacheTag,
  summaryFor,
  type EboardStandingsConfig,
  type GroupBonusInput,
} from "./points";
import { prisma } from "./prisma";
import type {
  AccountState,
  AdminLogEntry,
  AttendanceRecord,
  Audience,
  AuthRecord,
  AwardKind,
  BonusTier,
  Classification,
  Event,
  EventCategory,
  EventGroup,
  EventStatus,
  FieldType,
  FileKind,
  FormField,
  GroupKind,
  JoinCodeSummary,
  Member,
  MemberSummary,
  Org,
  PointAward,
  PointBreakdown,
  Role,
  ShirtSize,
  Standing,
  UploadedFile,
  UserStatus,
} from "./types";

type Tx = Prisma.TransactionClient;

const MAX_EXTRA_QUESTIONS_HARD_CAP = 5;

// ---------------------------------------------------------------------------
// Enum mapping — the only place lowercase domain enums meet Prisma's enums.
// ---------------------------------------------------------------------------

function roleFromDb(r: DbRole): Role {
  if (r === DbRole.ADMIN) return "admin";
  if (r === DbRole.EBOARD) return "eboard";
  if (r === DbRole.GUEST) return "guest";
  return "general";
}

function roleToDb(r: Role): DbRole {
  if (r === "admin") return DbRole.ADMIN;
  if (r === "eboard") return DbRole.EBOARD;
  if (r === "guest") return DbRole.GUEST;
  return DbRole.GENERAL;
}

function classificationFromDb(c: DbClassification | null): Classification | "" {
  switch (c) {
    case DbClassification.FRESHMAN:
      return "freshman";
    case DbClassification.SOPHOMORE:
      return "sophomore";
    case DbClassification.JUNIOR:
      return "junior";
    case DbClassification.SENIOR:
      return "senior";
    case DbClassification.GRADUATE:
      return "graduate";
    default:
      return "";
  }
}

function classificationToDb(c: Classification): DbClassification {
  switch (c) {
    case "freshman":
      return DbClassification.FRESHMAN;
    case "sophomore":
      return DbClassification.SOPHOMORE;
    case "junior":
      return DbClassification.JUNIOR;
    case "senior":
      return DbClassification.SENIOR;
    case "graduate":
      return DbClassification.GRADUATE;
  }
}

function shirtSizeFromDb(s: DbShirtSize | null): ShirtSize | "" {
  return s ?? "";
}

function shirtSizeToDb(s: ShirtSize): DbShirtSize {
  return s as DbShirtSize;
}

function fileKindFromDb(k: DbFileKind): FileKind {
  return k === DbFileKind.RESUME ? "resume" : "house_proof";
}

function fileKindToDb(k: FileKind): DbFileKind {
  return k === "resume" ? DbFileKind.RESUME : DbFileKind.HOUSE_PROOF;
}

/** Only one value exists today (GroupKind is extensible per the schema comment) — a real mapping table once a second kind is added. */
function groupKindFromDb(_k: DbGroupKind): GroupKind {
  return "nsbe_week";
}

function groupKindToDb(_k: GroupKind): DbGroupKind {
  return DbGroupKind.NSBE_WEEK;
}

function awardKindFromDb(k: DbAwardKind): AwardKind {
  if (k === DbAwardKind.GAME_COMPETITION) return "game_competition";
  if (k === DbAwardKind.MONTHLY_CHAMPION) return "monthly_champion";
  return "manual";
}

function awardKindToDb(k: AwardKind): DbAwardKind {
  if (k === "game_competition") return DbAwardKind.GAME_COMPETITION;
  if (k === "monthly_champion") return DbAwardKind.MONTHLY_CHAMPION;
  return DbAwardKind.MANUAL;
}

function statusFromDb(s: DbUserStatus): UserStatus {
  if (s === DbUserStatus.ACTIVE) return "active";
  if (s === DbUserStatus.SUSPENDED) return "suspended";
  return "pending";
}

function statusToDb(s: UserStatus): DbUserStatus {
  if (s === "active") return DbUserStatus.ACTIVE;
  if (s === "suspended") return DbUserStatus.SUSPENDED;
  return DbUserStatus.PENDING;
}

function audienceFromDb(a: DbAudience): Audience {
  return a === DbAudience.EBOARD_ONLY ? "eboard_only" : "all";
}

function audienceToDb(a: Audience): DbAudience {
  return a === "eboard_only" ? DbAudience.EBOARD_ONLY : DbAudience.ALL;
}

function eventStatusFromDb(s: DbEventStatus): EventStatus {
  if (s === DbEventStatus.SCHEDULED) return "scheduled";
  if (s === DbEventStatus.CANCELED) return "canceled";
  return "draft";
}

const FIELD_TYPE_FROM_DB: Record<DbFieldType, FieldType> = {
  SHORT_TEXT: "short_text",
  LONG_TEXT: "long_text",
  SELECT: "select",
  MULTI_SELECT: "multi_select",
  NUMBER: "number",
  YES_NO: "yes_no",
  RATING: "rating",
  DATE: "date",
};
const FIELD_TYPE_TO_DB: Record<FieldType, DbFieldType> = {
  short_text: DbFieldType.SHORT_TEXT,
  long_text: DbFieldType.LONG_TEXT,
  select: DbFieldType.SELECT,
  multi_select: DbFieldType.MULTI_SELECT,
  number: DbFieldType.NUMBER,
  yes_no: DbFieldType.YES_NO,
  rating: DbFieldType.RATING,
  date: DbFieldType.DATE,
};

/** MANUAL -> "manual" is the only value any component checks for exactly; FORM -> "form" is otherwise just display text. */
function sourceFromDb(s: DbSource): string {
  return s === DbSource.MANUAL ? "manual" : "form";
}

// ---------------------------------------------------------------------------
// Row <-> domain mapping
// ---------------------------------------------------------------------------

function userToMember(u: UserModel): Member {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    studentId: u.studentId ?? "",
    classification: classificationFromDb(u.classification),
    major: u.major ?? "",
    majorOther: u.majorOther ?? "",
    membership: u.membership ?? "",
    phone: u.phone ?? "",
    personalEmail: u.personalEmail ?? "",
    tshirtSize: shirtSizeFromDb(u.tshirtSize),
    role: roleFromDb(u.role),
    status: statusFromDb(u.status),
    joinedAt: u.createdAt,

    eboardPosition: u.eboardPosition ?? "",

    duesPaidReported: u.duesPaidReported,
    duesReportedAt: u.duesReportedAt,
    duesVerifiedAt: u.duesVerifiedAt,
    duesRevokedAt: u.duesRevokedAt,
    duesRevokedById: u.duesRevokedById ?? "",
    duesRevokedNote: u.duesRevokedNote ?? "",

    nationalMemberReported: u.nationalMemberReported,
    nsbeMembershipId: u.nsbeMembershipId ?? "",
    nationalVerifiedAt: u.nationalVerifiedAt,
    nationalRevokedAt: u.nationalRevokedAt,
    nationalRevokedById: u.nationalRevokedById ?? "",
    nationalRevokedNote: u.nationalRevokedNote ?? "",

    membershipSeason: u.membershipSeason ?? "",
    profileSeason: u.profileSeason ?? "",

    house: u.house ?? "",
    houseVerifiedAt: u.houseVerifiedAt,
    houseProofFileId: u.houseProofFileId,

    resumeFileId: u.resumeFileId,
    resumeUpdatedAt: u.resumeUpdatedAt,
    resumeConsentAt: u.resumeConsentAt,
  };
}

function uploadedFileToDomain(f: UploadedFileModel): UploadedFile {
  return {
    id: f.id,
    userId: f.userId,
    kind: fileKindFromDb(f.kind),
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: f.sizeBytes,
    createdAt: f.createdAt,
  };
}

function userToAuthRecord(u: UserModel): AuthRecord {
  return {
    email: u.email,
    passwordHash: u.passwordHash,
    role: roleFromDb(u.role),
    mustChangePassword: u.mustChangePassword,
    status: statusFromDb(u.status),
  };
}

function orgToDomain(o: OrgModel): Org {
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    shortName: o.shortName,
    logoUrl: o.logoUrl ?? "",
    primaryColor: o.primaryColor ?? "",
    active: o.active,
  };
}

function joinCodeToSummary(j: JoinCodeModel): JoinCodeSummary {
  return {
    id: j.id,
    label: j.label,
    grantsRole: roleFromDb(j.grantsRole),
    codeHint: j.codeHint,
    active: j.active,
    expiresAt: j.expiresAt,
    maxUses: j.maxUses,
    useCount: j.useCount,
    createdAt: j.createdAt,
    rotatedAt: j.rotatedAt,
  };
}

/** Every Event query in this module includes its category — see EVENT_INCLUDE below — so eventToDomain always has a live snapshot to embed. */
const EVENT_INCLUDE = { category: true } as const;

function eventCategoryToDomain(c: EventCategoryModel): EventCategory {
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    shortName: c.shortName,
    tier: c.tier,
    memberPoints: c.memberPoints,
    examples: c.examples ?? "",
    countsForMonthly: c.countsForMonthly,
    eboardEligible: c.eboardEligible,
    audience: audienceFromDb(c.audience),
    active: c.active,
    sortOrder: c.sortOrder,
  };
}

function eventGroupToDomain(g: EventGroupModel & { events?: Array<{ id: string }> }): EventGroup {
  return {
    id: g.id,
    name: g.name,
    slug: g.slug,
    kind: groupKindFromDb(g.kind),
    expectedEventCount: g.expectedEventCount,
    bonusTiers: (g.bonusTiers as unknown as BonusTier[] | null) ?? [],
    eventIds: (g.events ?? []).map((e) => e.id),
    finalizedAt: g.finalizedAt,
    finalizedById: g.finalizedById ?? "",
    createdAt: g.createdAt,
  };
}

function pointAwardToDomain(a: PointAwardModel & { user: { email: string } }): PointAward {
  return {
    id: a.id,
    email: a.user.email,
    kind: awardKindFromDb(a.kind),
    points: a.points,
    eventId: a.eventId,
    periodMonth: a.periodMonth,
    reason: a.reason,
    awardedById: a.awardedById ?? "",
    awardedAt: a.awardedAt,
    revokedAt: a.revokedAt,
    revokedById: a.revokedById ?? "",
    revokeNote: a.revokeNote ?? "",
  };
}

function eventToDomain(e: EventModel & { category: EventCategoryModel }): Event {
  return {
    eventId: e.id,
    slug: e.slug,
    name: e.name,
    categoryId: e.categoryId,
    category: eventCategoryToDomain(e.category),
    groupId: e.groupId,
    date: e.date,
    location: e.location ?? "",
    description: e.description ?? "",
    points: e.pointsOverride,
    status: eventStatusFromDb(e.status),
    opensAt: e.opensAt,
    closesAt: e.closesAt,
    durationMinutes: e.durationMinutes,
    openedBy: e.openedById ?? "",
    openedAt: e.openedAt,
    createdBy: e.createdById ?? "",
    createdAt: e.createdAt,
    audience: audienceFromDb(e.audience),
  };
}

function formFieldToDomain(f: FormFieldModel): FormField {
  return {
    eventId: f.eventId,
    fieldKey: f.fieldKey,
    label: f.label,
    type: FIELD_TYPE_FROM_DB[f.type],
    required: f.required,
    options: f.options,
    helpText: f.helpText ?? "",
    order: f.order,
    prefill: f.prefill ?? "",
  };
}

/** Every Registration query used for AttendanceRecord includes this — see REGISTRATION_ATTENDANCE_INCLUDE below. */
const REGISTRATION_ATTENDANCE_INCLUDE = {
  user: { select: { email: true } },
  event: { select: { pointsOverride: true, closesAt: true, category: true } },
} as const;

function registrationToAttendance(
  r: RegistrationModel & {
    user: { email: string };
    event: { pointsOverride: number | null; closesAt: Date | null; category: EventCategoryModel };
  },
): AttendanceRecord {
  return {
    id: r.id,
    timestamp: r.createdAt,
    eventId: r.eventId,
    email: r.user.email,
    role: roleFromDb(r.roleAtTime),
    pointsAwarded: r.pointsAwarded,
    source: sourceFromDb(r.source),
    note: r.note ?? "",
    eventPointsOverride: r.event.pointsOverride,
    closesAt: r.event.closesAt,
    category: eventCategoryToDomain(r.event.category),
  };
}

function adminLogToDomain(l: AdminLogModel & { actor: { email: string } | null }): AdminLogEntry {
  return {
    timestamp: l.createdAt,
    actor: l.actor?.email ?? "",
    action: l.action,
    target: l.target ?? "",
    detail: l.detail ?? "",
  };
}

/**
 * Appends an audit row inside the caller's own transaction — every admin
 * mutation writes one of these, atomically with the mutation itself, never as
 * a separate best-effort write after the fact.
 */
async function logAdminAction(
  tx: Tx,
  orgId: string,
  entry: { actor: string; action: string; target: string; detail?: string },
): Promise<void> {
  const actorUser = await tx.user.findUnique({
    where: { orgId_email: { orgId, email: entry.actor.trim().toLowerCase() } },
    select: { id: true },
  });
  await tx.adminLog.create({
    data: {
      orgId,
      actorId: actorUser?.id ?? null,
      action: entry.action,
      target: entry.target,
      detail: entry.detail ?? null,
    },
  });
}

/**
 * logAdminAction, for a caller with no open transaction — the two UX-gate
 * check-in code endpoints (verify-code route.ts, guest verifyGuestEventCodeAction)
 * aren't part of any write transaction, unlike every other AdminLog call site
 * in this file. Same shape, same "actor" resolution (an email string, or a
 * non-human value like "system" that resolves to a null actorId).
 */
export async function logSystemAdminEvent(
  orgId: string,
  entry: { actor: string; action: string; target: string; detail?: string },
): Promise<void> {
  await logAdminAction(prisma, orgId, entry);
}

/**
 * The per-EVENT half of check-in code verification, shared by all four call
 * sites that ever check a code (the member UX-gate route, the guest UX-gate
 * action, and the two real security boundaries — registerForEvent and
 * registerGuest below). Distinct from the existing per-member/IP limiter
 * (lib/rate-limit.ts assertNotCodeVerifyRateLimited), which callers still
 * check/record themselves where they already did — this only adds the
 * EVENT-wide view a distributed attacker (many accounts) can't route around.
 *
 * Locked: throws EVENT_NOT_OPEN with the same paused-for-check-in message a
 * genuinely closed event would give — never a distinct error, so a
 * distributed attacker can't tell "closed" from "brute-force locked" apart.
 * Bad code: records the failure (per-event counter; an AdminLog "suspected"
 * entry on the first crossing of the soft threshold, never one per attempt)
 * and throws BAD_CODE, same message as always. Good code: returns silently,
 * touching neither limiter.
 */
export async function verifyEventCodeOrThrow(input: {
  orgId: string;
  eventId: string;
  code: string;
  now: Date;
  /** For the structured failure log only — never used as a rate-limit key (callers already keyed the per-member/IP limiter themselves). */
  who: string;
  ip: string;
}): Promise<void> {
  const nowMs = input.now.getTime();
  if (isEventCodeLocked(input.eventId, nowMs)) {
    throw new AppError("EVENT_NOT_OPEN", "Check-in is temporarily paused — see an E-Board member");
  }
  if (verifyCode(input.eventId, input.code, input.now)) return;

  console.warn(
    JSON.stringify({
      event: "code_verify_failed",
      orgId: input.orgId,
      eventId: input.eventId,
      who: input.who,
      ipHash: hashIp(input.ip),
    }),
  );
  const [softRaw, hardRaw] = await Promise.all([
    getConfigValue(input.orgId, "EVENT_CODE_FAIL_SOFT", "100"),
    getConfigValue(input.orgId, "EVENT_CODE_FAIL_HARD", "250"),
  ]);
  const soft = Number(softRaw) || 100;
  const hard = Number(hardRaw) || 250;
  const { crossedSoft } = recordEventCodeFailure(input.eventId, soft, hard, nowMs);
  if (crossedSoft) {
    await logSystemAdminEvent(input.orgId, {
      actor: "system",
      action: "code_brute_force_suspected",
      target: input.eventId,
      detail: `${soft}+ failed check-in code attempts in the last ${EVENT_CODE_FAIL_WINDOW_MINUTES} minutes`,
    });
  }
  throw new AppError("BAD_CODE", "That code isn't right. Check the display and try again.");
}

const EVENT_CODE_FAIL_WINDOW_MINUTES = 10;

function slugify(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "event"
  );
}

async function uniqueSlug(tx: Tx, orgId: string, base: string, excludeId?: string): Promise<string> {
  let candidate = base;
  let n = 2;
  for (;;) {
    const existing = await tx.event.findUnique({ where: { orgId_slug: { orgId, slug: candidate } }, select: { id: true } });
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}-${n++}`;
  }
}

// ---------------------------------------------------------------------------
// Org lookup — the only two functions in this module that DON'T take an
// orgId, because they're how a caller gets one. See lib/org.ts.
// ---------------------------------------------------------------------------

export async function getOrgBySlug(slug: string): Promise<Org | null> {
  const row = await prisma.org.findUnique({ where: { slug: slug.trim().toLowerCase() } });
  return row ? orgToDomain(row) : null;
}

export async function getOrgById(id: string): Promise<Org | null> {
  const row = await prisma.org.findUnique({ where: { id } });
  return row ? orgToDomain(row) : null;
}

export async function getActiveOrgs(): Promise<Org[]> {
  const rows = await prisma.org.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return rows.map(orgToDomain);
}

// ---------------------------------------------------------------------------
// Read accessors
// ---------------------------------------------------------------------------

export async function getMembers(orgId: string): Promise<Member[]> {
  const users = await prisma.user.findMany({ where: { orgId }, orderBy: { lastName: "asc" } });
  return users.map(userToMember);
}

export async function getMember(orgId: string, email: string): Promise<Member | null> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } } });
  return user ? userToMember(user) : null;
}

/** Keyed by the internal id (cuid) — used for /admin/members/[id], consistent with /events/[id]. */
export async function getMemberById(orgId: string, id: string): Promise<Member | null> {
  const user = await prisma.user.findFirst({ where: { id, orgId } });
  return user ? userToMember(user) : null;
}

export async function getRole(orgId: string, email: string): Promise<Role> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } }, select: { role: true } });
  return user ? roleFromDb(user.role) : "general";
}

export async function getUserStatus(orgId: string, email: string): Promise<UserStatus | null> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } }, select: { status: true } });
  return user ? statusFromDb(user.status) : null;
}

/** The internal id behind an email — needed wherever a caller only has a session email but must write a foreign key (e.g. UploadedFile.userId). */
export async function getUserId(orgId: string, email: string): Promise<string | null> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * The ONLY function that returns passwordHash. Everything else that reads
 * Users (getMembers, getMember, ...) maps through userToMember(), which never
 * touches it.
 */
export async function getAuthRecord(orgId: string, email: string): Promise<AuthRecord | null> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } } });
  return user ? userToAuthRecord(user) : null;
}

/** Config.LEADERBOARD_DISCLAIMER's default — shown on /leaderboard and in both the CSV and Excel exports until an E-Board member edits it from /admin/settings. */
export const DEFAULT_LEADERBOARD_DISCLAIMER =
  "Leaderboard standing does not guarantee selection for conferences, but it plays a significant role in the selection process.";

/** Config.NATIONAL_MEMBERSHIP_URL's default — nsbe.org's current membership landing page (join + renew), verified live as of this default's introduction. */
export const DEFAULT_NATIONAL_MEMBERSHIP_URL = "https://nsbe.org/memberships/";

export async function getConfig(orgId: string): Promise<Record<string, string>> {
  const rows = await prisma.config.findMany({ where: { orgId } });
  const config: Record<string, string> = {};
  for (const row of rows) config[row.key] = row.value;
  return config;
}

export async function getConfigValue(orgId: string, key: string, fallback = ""): Promise<string> {
  const row = await prisma.config.findUnique({ where: { orgId_key: { orgId, key } } });
  return row?.value ?? fallback;
}

export async function setConfigValue(orgId: string, key: string, value: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.config.upsert({
      where: { orgId_key: { orgId, key } },
      update: { value },
      create: { orgId, key, value },
    });
    await logAdminAction(tx, orgId, { actor, action: "update_config", target: key, detail: value });
  });
}

/** Config.ADMIN_EMAIL_ALLOWLIST — pipe-delimited, same convention as MAJORS_LIST (see getCoreFormConfig). */
export async function getAdminEmailAllowlist(orgId: string): Promise<string[]> {
  const raw = await getConfigValue(orgId, "ADMIN_EMAIL_ALLOWLIST", "");
  return raw
    .split("|")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The LOGIN-time domain gate: an email may sign in only if it ends with
 * Config.ALLOWED_EMAIL_DOMAIN OR appears in Config.ADMIN_EMAIL_ALLOWLIST.
 * When no domain is configured there's nothing to gate, so every email
 * passes — same "no restriction configured" behavior as the signup check in
 * (public)/join/actions.ts.
 *
 * Deliberately NOT consulted by signup: the allowlist exists only so the
 * seven pre-seeded ADMIN accounts (prisma/seed.ts seedHardcodedAdmins, all
 * @gmail.com) can sign in — it must never let one of those addresses create a
 * NEW account at /join, since those accounts already exist and are seeded,
 * not self-created. See lib/auth.ts authorize(), the only caller.
 */
export async function isLoginEmailAllowed(orgId: string, email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const [domain, allowlist] = await Promise.all([
    getConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", ""),
    getAdminEmailAllowlist(orgId),
  ]);
  const d = domain.trim().toLowerCase();
  if (!d) return true;
  return e.endsWith(d) || allowlist.includes(e);
}

export async function getEvents(orgId: string): Promise<Event[]> {
  const rows = await prisma.event.findMany({ where: { orgId }, include: EVENT_INCLUDE, orderBy: { createdAt: "desc" } });
  return rows.map(eventToDomain);
}

export async function getEvent(orgId: string, eventId: string): Promise<Event | null> {
  const row = await prisma.event.findFirst({ where: { id: eventId, orgId }, include: EVENT_INCLUDE });
  return row ? eventToDomain(row) : null;
}

export async function getOpenEvents(orgId: string, now: Date): Promise<Event[]> {
  const rows = await prisma.event.findMany({ where: { orgId, status: DbEventStatus.SCHEDULED }, include: EVENT_INCLUDE });
  return rows.map(eventToDomain).filter((e) => isOpen(e, now));
}

/** Open right now, ALL audience only — the guest event feed (Part 5). No EBOARD_ONLY event ever shows here, and no point values are attached to the domain type this returns. */
export async function getOpenGuestEvents(orgId: string, now: Date): Promise<Event[]> {
  return (await getOpenEvents(orgId, now)).filter((e) => e.audience === "all");
}

export async function getFormFields(orgId: string, eventId: string): Promise<FormField[]> {
  const rows = await prisma.formField.findMany({
    where: { eventId, event: { orgId } },
    orderBy: { order: "asc" },
  });
  return rows.map(formFieldToDomain);
}

/** Single joined query (Registration -> User, Event -> Category) — never one query per row. */
export async function getAttendance(orgId: string): Promise<AttendanceRecord[]> {
  const rows = await prisma.registration.findMany({
    where: { event: { orgId } },
    include: REGISTRATION_ATTENDANCE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(registrationToAttendance);
}

export async function getAttendanceForEvent(orgId: string, eventId: string): Promise<AttendanceRecord[]> {
  const rows = await prisma.registration.findMany({
    where: { eventId, event: { orgId } },
    include: REGISTRATION_ATTENDANCE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(registrationToAttendance);
}

export async function getPointAwards(orgId: string): Promise<PointAward[]> {
  const rows = await prisma.pointAward.findMany({
    where: { orgId },
    include: { user: { select: { email: true } } },
    orderBy: { awardedAt: "desc" },
  });
  return rows.map(pointAwardToDomain);
}

/** Every EventGroup query used for bonus math includes this — the group's own events, just enough to decide completion and count attendance. */
async function getGroupBonusInputs(orgId: string): Promise<GroupBonusInput[]> {
  const groups = await prisma.eventGroup.findMany({
    where: { orgId },
    include: { events: { select: { id: true, status: true, closesAt: true } } },
  });
  return groups.map((g) => ({
    events: g.events.map((e) => ({ eventId: e.id, status: eventStatusFromDb(e.status), closesAt: e.closesAt })),
    bonusTiers: (g.bonusTiers as unknown as BonusTier[] | null) ?? [],
    finalizedAt: g.finalizedAt,
  }));
}

export async function getStandings(orgId: string): Promise<Standing[]> {
  const [attendance, members, season, awards, groups] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getConfigValue(orgId, "SEASON", ""),
    getPointAwards(orgId),
    getGroupBonusInputs(orgId),
  ]);
  return computeStandings(attendance, members, season, awards, groups, new Date());
}

/**
 * Same computation as getStandings, but takes `season` as a parameter
 * instead of reading it from Config — used exclusively by
 * lib/standings-cache.ts's getCachedStandings, whose cache key already
 * carries season, so the cached closure must not re-derive it from a second
 * Config read (that would make the cache key and the data it returns
 * disagree on which season was actually queried). Every other caller
 * (getMemberSummary, registerForEvent) keeps using the live, uncached
 * getStandings above.
 */
export async function getStandingsForSeason(orgId: string, season: string): Promise<Standing[]> {
  const [attendance, members, awards, groups] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getPointAwards(orgId),
    getGroupBonusInputs(orgId),
  ]);
  return computeStandings(attendance, members, season, awards, groups, new Date());
}

/**
 * Every mutation that can change the standings board (Registration
 * created/deleted, PointAward created/revoked, an EventGroup finalized, a
 * role change, an eligibility change, or a category point-value edit) calls
 * this right after its write commits. Tag format is shared with
 * lib/standings-cache.ts's getCachedStandings via points.ts's
 * standingsCacheTag — the two files never import each other just to agree on
 * a string. `{ expire: 0 }` (not the one-argument form) is required by this
 * Next.js version — see revalidateTag's current signature.
 */
function invalidateStandings(orgId: string, season: string): void {
  try {
    revalidateTag(standingsCacheTag(orgId, season), { expire: 0 });
  } catch {
    // revalidateTag throws outside a Next.js request scope (a script, a
    // background job, or — today — a repo.test.ts call with no server
    // context to attach to). The mutation that triggered this already
    // committed; worst case here is the cache serving up to 30s of stale
    // data until its own revalidate window rolls over on its own, never a
    // reason to fail the write itself.
  }
}

/** Same computation as getStandings, but keeps each row's full PointBreakdown — for the leaderboard's row-expand. */
export async function getStandingsWithBreakdowns(orgId: string): Promise<Array<Standing & { breakdown: PointBreakdown }>> {
  const [attendance, members, season, awards, groups] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getConfigValue(orgId, "SEASON", ""),
    getPointAwards(orgId),
    getGroupBonusInputs(orgId),
  ]);
  return computeStandingsWithBreakdowns(attendance, members, season, awards, groups, new Date());
}

/** Same relationship to getStandingsWithBreakdowns as getStandingsForSeason has to getStandings — used only by lib/standings-cache.ts's getCachedStandingsWithBreakdowns. */
export async function getStandingsWithBreakdownsForSeason(
  orgId: string,
  season: string,
): Promise<Array<Standing & { breakdown: PointBreakdown }>> {
  const [attendance, members, awards, groups] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getPointAwards(orgId),
    getGroupBonusInputs(orgId),
  ]);
  return computeStandingsWithBreakdowns(attendance, members, season, awards, groups, new Date());
}

/**
 * One member's own full breakdown, regardless of eligibility — bonuses and
 * event points accrue for an ineligible member exactly as they do for an
 * eligible one (Part: "recorded, not counted, until they report"); this is
 * what /dashboard shows them so there's something real to see, even though
 * getStandings excludes them from the board entirely until they report.
 */
export async function getMemberBreakdown(orgId: string, email: string): Promise<PointBreakdown> {
  const e = email.trim().toLowerCase();
  const zero: PointBreakdown = { eventPoints: 0, nsbeWeekBonus: 0, gameBonus: 0, monthlyChampionBonus: 0, manualBonus: 0, total: 0 };
  const [member, attendance, awards, groups] = await Promise.all([
    getMember(orgId, e),
    getMemberHistory(orgId, e),
    getPointAwards(orgId),
    getGroupBonusInputs(orgId),
  ]);
  if (!member) return zero;
  const memberAwards = awards.filter((a) => a.email.toLowerCase() === e);
  return memberTotal(member, attendance, memberAwards, groups, new Date());
}

export async function getMemberSummary(orgId: string, email: string): Promise<MemberSummary> {
  const standings = await getStandings(orgId);
  return summaryFor(email, standings);
}

/**
 * The dashboard's "own row" query: `cachedStandings` (from
 * lib/standings-cache.ts's getCachedStandings, up to 30s stale) supplies
 * everyone else's rank context, but this member's own total/eligibility is
 * always computed fresh — a member must see their own points update
 * instantly after checking in, not after waiting out the cache window. Rank
 * is derived by slotting the fresh total into the cached board via
 * lib/points.ts rankWithLiveSelf, so it stays consistent with
 * computeStandings' own tie-break rules.
 */
export async function getMemberSummaryLive(
  orgId: string,
  email: string,
  season: string,
  cachedStandings: Standing[],
): Promise<MemberSummary> {
  const e = email.trim().toLowerCase();
  const [member, attendance, awards, groups] = await Promise.all([
    getMember(orgId, e),
    getMemberHistory(orgId, e),
    getPointAwards(orgId),
    getGroupBonusInputs(orgId),
  ]);
  if (!member || member.role !== "general" || !isEligible(member, season)) {
    return { email: e, points: 0, events: 0, rank: null, totalRanked: cachedStandings.length };
  }
  const memberAwards = awards.filter((a) => a.email === e);
  const breakdown = memberTotal(member, attendance, memberAwards, groups, new Date());
  // Cached snapshot may or may not already contain this member's own (stale)
  // row — count everyone else once, then add self back in, rather than
  // trusting cachedStandings.length directly.
  const otherCount = cachedStandings.filter((s) => s.email.toLowerCase() !== e).length;
  const rank = rankWithLiveSelf(cachedStandings, {
    email: e,
    firstName: member.firstName,
    lastName: member.lastName,
    points: breakdown.total,
    events: attendance.length,
  });
  return { email: e, points: breakdown.total, events: attendance.length, rank, totalRanked: otherCount + 1 };
}

// ---------------------------------------------------------------------------
// Internal E-Board track — a second read-time interpretation of the SAME
// Registration ledger the member board reads (see lib/points.ts
// eboardAwardFor / computeEboardStandings). Never a second data store, and
// explicitly untouched by Part 1-3's tiers/NSBE-Week bonus/game bonus/
// monthly champion — computeEboardStandings doesn't even accept them.
// ---------------------------------------------------------------------------

export async function getEboardScoringConfig(orgId: string): Promise<EboardStandingsConfig> {
  const [pointValue, trackEnabledRaw, requireMembershipRaw, currentSeason] = await Promise.all([
    getConfigValue(orgId, "EBOARD_POINT_VALUE", "1"),
    getConfigValue(orgId, "EBOARD_TRACK_ENABLED", "true"),
    getConfigValue(orgId, "EBOARD_REQUIRES_MEMBERSHIP", "false"),
    getConfigValue(orgId, "SEASON", ""),
  ]);
  return {
    EBOARD_POINT_VALUE: pointValue,
    EBOARD_TRACK_ENABLED: trackEnabledRaw === "true",
    requireMembership: requireMembershipRaw === "true",
    currentSeason,
  };
}

export async function getEboardStandings(orgId: string): Promise<Standing[]> {
  const [attendance, members, config] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getEboardScoringConfig(orgId),
  ]);
  return computeEboardStandings(attendance, members, config);
}

export async function getEboardSummary(orgId: string, email: string): Promise<MemberSummary> {
  const standings = await getEboardStandings(orgId);
  return summaryFor(email, standings);
}

export interface EboardCategoryStats {
  points: number;
  attended: number;
  /** Events in this category, this season, that actually happened and count toward the internal track. */
  eligible: number;
}

export interface EboardBoardRow extends Standing {
  eboardPosition: string;
  chapter: EboardCategoryStats;
  eboardMeetings: EboardCategoryStats;
  retreats: EboardCategoryStats;
}

export type EboardCategory = "chapter" | "eboardMeetings" | "retreats";

/** The breakdown is just the category code — EBOARD_MEETING/EBOARD_RETREAT are their own buckets, everything else is a chapter event. */
function eboardCategoryFor(categoryCode: string): EboardCategory {
  if (categoryCode === "EBOARD_MEETING") return "eboardMeetings";
  if (categoryCode === "EBOARD_RETREAT") return "retreats";
  return "chapter";
}

/**
 * The full internal leaderboard: standings plus, per category, points/events
 * attended and an attendance rate (attended / eligible-events-in-that-category,
 * counted across the whole season — not prorated to when a member joined, so
 * a mid-season officer's rate for earlier events is correspondingly low, by
 * design). "Eligible" events are ones that actually happened
 * (openedAt !== null) and count toward the track (category.eboardEligible).
 */
export interface EboardBoardFilter {
  from?: Date;
  to?: Date;
  category?: EboardCategory;
}

export async function getEboardBoardRows(orgId: string, filter?: EboardBoardFilter): Promise<EboardBoardRow[]> {
  const [attendanceAll, members, eventsAll, config] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getEvents(orgId),
    getEboardScoringConfig(orgId),
  ]);

  const inRange = (ts: Date | null): boolean => {
    if (!ts) return false;
    if (filter?.from && ts < filter.from) return false;
    if (filter?.to && ts > filter.to) return false;
    return true;
  };

  // Category/date-range filters (Part 4) recompute the whole board over the
  // filtered subset — points/rank reflect exactly what's currently visible,
  // not the full season with a display-only filter layered on top.
  const events = filter?.category ? eventsAll.filter((e) => eboardCategoryFor(e.category.code) === filter.category) : eventsAll;
  const eventIdsInCategory = new Set(events.map((e) => e.eventId));
  const attendance = attendanceAll.filter(
    (row) => inRange(row.timestamp) && (!filter?.category || eventIdsInCategory.has(row.eventId)),
  );

  const standings = computeEboardStandings(attendance, members, config);

  const eventById = new Map(eventsAll.map((e) => [e.eventId, e]));
  const memberByEmail = new Map(members.map((m) => [m.email, m]));

  const eligibleCounts: Record<EboardCategory, number> = { chapter: 0, eboardMeetings: 0, retreats: 0 };
  for (const e of events) {
    if (!e.category.eboardEligible || e.openedAt === null || !inRange(e.openedAt)) continue;
    eligibleCounts[eboardCategoryFor(e.category.code)] += 1;
  }

  const emptyStats = (): EboardCategoryStats => ({ points: 0, attended: 0, eligible: 0 });
  const byEmail = new Map<string, Record<EboardCategory, EboardCategoryStats>>();
  for (const s of standings) {
    byEmail.set(s.email, { chapter: emptyStats(), eboardMeetings: emptyStats(), retreats: emptyStats() });
  }
  for (const row of attendance) {
    const buckets = byEmail.get(row.email);
    if (!buckets) continue;
    const event = eventById.get(row.eventId);
    if (!event) continue;
    const stats = buckets[eboardCategoryFor(event.category.code)];
    stats.attended += 1;
    stats.points += eboardAwardFor("eboard", event.category, config);
  }
  for (const buckets of byEmail.values()) {
    for (const category of ["chapter", "eboardMeetings", "retreats"] as const) {
      buckets[category].eligible = eligibleCounts[category];
    }
  }

  return standings.map((s) => {
    const buckets = byEmail.get(s.email)!;
    return { ...s, eboardPosition: memberByEmail.get(s.email)?.eboardPosition ?? "", ...buckets };
  });
}

/** Filtered directly by user (via the Registration_userId_idx), not a slice of the full attendance log. */
export async function getMemberHistory(orgId: string, email: string): Promise<AttendanceRecord[]> {
  const e = email.trim().toLowerCase();
  const rows = await prisma.registration.findMany({
    where: { user: { orgId, email: e } },
    include: REGISTRATION_ATTENDANCE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(registrationToAttendance);
}

export async function getAuthRecords(orgId: string): Promise<AuthRecord[]> {
  const users = await prisma.user.findMany({ where: { orgId } });
  return users.map(userToAuthRecord);
}

export async function getAdminLog(orgId: string): Promise<AdminLogEntry[]> {
  const rows = await prisma.adminLog.findMany({
    where: { orgId },
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(adminLogToDomain);
}

export interface EventWithStats extends Event {
  registrationCount: number;
}

/** One query with a _count aggregate — not one COUNT per event. */
export async function getEventsWithStats(orgId: string): Promise<EventWithStats[]> {
  const rows = await prisma.event.findMany({
    where: { orgId },
    include: { ...EVENT_INCLUDE, _count: { select: { registrations: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((e) => ({ ...eventToDomain(e), registrationCount: e._count.registrations }));
}

export interface EventResponseRow {
  id: string;
  timestamp: Date | null;
  email: string;
  firstName: string;
  lastName: string;
  pointsAwarded: number;
  answers: Record<string, string>;
}

/** One query (Registration -> User + Answers) per event — never one query per response. */
export async function getEventResponses(orgId: string, eventId: string): Promise<EventResponseRow[]> {
  const rows = await prisma.registration.findMany({
    where: { eventId, event: { orgId } },
    include: {
      user: { select: { email: true, firstName: true, lastName: true } },
      answers: true,
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    timestamp: r.createdAt,
    email: r.user.email,
    firstName: r.user.firstName,
    lastName: r.user.lastName,
    pointsAwarded: r.pointsAwarded,
    answers: Object.fromEntries(r.answers.map((a) => [a.fieldKey, a.value])),
  }));
}

/**
 * Whether an event's schema is locked — true once even one response has been
 * submitted. Server-side gate for the form builder; a disabled control on the
 * client is UX only, never the actual security boundary.
 */
export async function hasEventResponses(orgId: string, eventId: string): Promise<boolean> {
  const row = await prisma.registration.findFirst({ where: { eventId, event: { orgId } }, select: { id: true } });
  return row !== null;
}

/**
 * Active: mustChangePassword is false — a real password has been chosen,
 * whether via self-service signup (immediate) or /set-password after a setup
 * code. Otherwise pending — distinguished by the most recent AdminLog entry
 * that touched this account, since mustChangePassword alone can't tell "never
 * set up" from "was reset" apart.
 */
export async function getAccountState(
  email: string,
  auth: AuthRecord | null,
  log: AdminLogEntry[],
): Promise<AccountState> {
  if (auth && !auth.mustChangePassword) return "active";
  const e = email.trim().toLowerCase();
  const last = log.find(
    (l) => l.target.toLowerCase() === e && (l.action === "create_member" || l.action === "reset_password"),
  );
  return last?.action === "reset_password" ? "reset_pending" : "setup_pending";
}

export interface MemberWithStats extends Member {
  /** Total earned regardless of eligibility — admins need the real number, unlike the member-facing dashboard. */
  points: number;
  events: number;
  accountState: AccountState;
  eligible: boolean;
  houseState: "none" | "pending" | "verified";
  /** Most recent of: last attendance, last AdminLog entry touching this member. Null if neither exists. */
  lastActiveAt: Date | null;
}

export async function getMembersWithStats(orgId: string): Promise<MemberWithStats[]> {
  const [members, attendance, authRecords, log, currentSeason] = await Promise.all([
    getMembers(orgId),
    getAttendance(orgId),
    getAuthRecords(orgId),
    getAdminLog(orgId),
    getConfigValue(orgId, "SEASON", ""),
  ]);
  const totalsByEmail = new Map<string, { points: number; events: number }>();
  const lastAttendanceByEmail = new Map<string, Date>();
  for (const row of attendance) {
    const entry = totalsByEmail.get(row.email) ?? { points: 0, events: 0 };
    entry.points += row.pointsAwarded;
    entry.events += 1;
    totalsByEmail.set(row.email, entry);
    if (row.timestamp) {
      const existing = lastAttendanceByEmail.get(row.email);
      if (!existing || row.timestamp > existing) lastAttendanceByEmail.set(row.email, row.timestamp);
    }
  }
  // log is already sorted createdAt desc (see getAdminLog) — the first entry
  // seen for a given target is its most recent.
  const lastLogByEmail = new Map<string, Date>();
  for (const entry of log) {
    const key = entry.target.trim().toLowerCase();
    if (!lastLogByEmail.has(key) && entry.timestamp) lastLogByEmail.set(key, entry.timestamp);
  }
  const authByEmail = new Map(authRecords.map((a) => [a.email, a]));

  return Promise.all(
    members.map(async (m) => {
      const totals = totalsByEmail.get(m.email);
      const accountState = await getAccountState(m.email, authByEmail.get(m.email) ?? null, log);
      const houseState: MemberWithStats["houseState"] = m.houseVerifiedAt
        ? "verified"
        : m.house
          ? "pending"
          : "none";
      const lastAttended = lastAttendanceByEmail.get(m.email) ?? null;
      const lastLogged = lastLogByEmail.get(m.email.trim().toLowerCase()) ?? null;
      const lastActiveAt =
        lastAttended && lastLogged ? (lastAttended > lastLogged ? lastAttended : lastLogged) : lastAttended ?? lastLogged;
      return {
        ...m,
        points: totals?.points ?? 0,
        events: totals?.events ?? 0,
        accountState,
        eligible: isEligible(m, currentSeason),
        houseState,
        lastActiveAt,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Membership verification queue — the operational cost of ELIGIBILITY_MODE
// VERIFIED. Every action here writes to AdminLog like every other admin
// mutation (see logAdminAction).
// ---------------------------------------------------------------------------

export async function getDuesPendingMembers(orgId: string): Promise<Member[]> {
  const rows = await prisma.user.findMany({
    where: { orgId, duesPaidReported: true, duesVerifiedAt: null, role: DbRole.GENERAL },
    orderBy: { duesReportedAt: "asc" },
  });
  return rows.map(userToMember);
}

export async function getNationalPendingMembers(orgId: string): Promise<Member[]> {
  const rows = await prisma.user.findMany({
    where: { orgId, nationalMemberReported: true, nationalVerifiedAt: null, role: DbRole.GENERAL },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(userToMember);
}

export async function getHousePendingMembers(orgId: string): Promise<Member[]> {
  const rows = await prisma.user.findMany({
    where: { orgId, house: { not: null }, houseVerifiedAt: null, role: DbRole.GENERAL },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(userToMember);
}

/** Verify/Revoke are pure audit now — neither gates the leaderboard (see lib/points.ts isEligible). Mutually exclusive: verifying clears a past revoke, and vice versa. */
export async function verifyDues(orgId: string, email: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: { duesVerifiedAt: new Date(), duesRevokedAt: null, duesRevokedById: null, duesRevokedNote: null },
    });
    await logAdminAction(tx, orgId, { actor, action: "verify_dues", target: e });
  });
}

/** Requires a note — an admin actively determined the self-reported claim was false. Drops the member from the leaderboard immediately and re-arms the check-in question (sets duesPaidReported false, same field the leaderboard filter and core-form re-ask both read). */
export async function revokeDues(orgId: string, email: string, actor: string, note: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    const actorUser = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
      select: { id: true },
    });
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: {
        duesPaidReported: false,
        duesVerifiedAt: null,
        duesRevokedAt: new Date(),
        duesRevokedById: actorUser?.id ?? null,
        duesRevokedNote: note,
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "revoke_dues", target: e, detail: note });
  });
  // duesPaidReported flips to false — can drop this member off the leaderboard.
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
}

export async function verifyNational(orgId: string, email: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: {
        nationalVerifiedAt: new Date(),
        nationalRevokedAt: null,
        nationalRevokedById: null,
        nationalRevokedNote: null,
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "verify_national", target: e });
  });
}

export async function revokeNational(orgId: string, email: string, actor: string, note: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    const actorUser = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
      select: { id: true },
    });
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: {
        nationalMemberReported: false,
        nationalVerifiedAt: null,
        nationalRevokedAt: new Date(),
        nationalRevokedById: actorUser?.id ?? null,
        nationalRevokedNote: note,
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "revoke_national", target: e, detail: note });
  });
  // nationalMemberReported flips to false — can drop this member off the leaderboard.
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
}

export async function verifyHouse(orgId: string, email: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { orgId_email: { orgId, email: e } }, data: { houseVerifiedAt: new Date() } });
    await logAdminAction(tx, orgId, { actor, action: "verify_house", target: e });
  });
}

export async function rejectHouse(orgId: string, email: string, actor: string, note?: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: { house: null, houseVerifiedAt: null, houseProofFileId: null },
    });
    await logAdminAction(tx, orgId, { actor, action: "reject_house", target: e, detail: note });
  });
}

/** Admin correction — the only path to change a House once it's verified. Requires a note (same shape as revokeDues/revokeNational) so the AdminLog entry explains why a verified House was overridden. */
export async function correctHouse(orgId: string, email: string, house: string, note: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { orgId_email: { orgId, email: e } }, data: { house, houseVerifiedAt: new Date() } });
    await logAdminAction(tx, orgId, { actor, action: "correct_house", target: e, detail: `${house} — ${note}` });
  });
}

// ---------------------------------------------------------------------------
// Self-service mutators — shared by /account, signup completion, and (for
// updateProfileFields) admin edits. registerForEvent applies the identical
// dues/national write rule inline, in the SAME transaction as the
// Registration it's creating (see Part 2) — it does not call these, but the
// rule (transitioning to true stamps membershipSeason; "No" doesn't touch
// it) is the one place that rule is documented; keep both in sync.
// ---------------------------------------------------------------------------

/** "Mark as paid" from /account, or an admin toggling it directly — the same season-stamp rule registerForEvent's check-in answer applies. */
export async function setDuesReported(orgId: string, email: string, reported: boolean, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const currentSeason = await getConfigValue(orgId, "SEASON", "");
  const season = reported ? currentSeason : null;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: {
        duesPaidReported: reported,
        duesReportedAt: new Date(),
        ...(season !== null ? { membershipSeason: season } : {}),
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "report_dues", target: e, detail: String(reported) });
  });
  // Toggling duesPaidReported can move this member on or off the leaderboard
  // (see lib/points.ts isEligible).
  invalidateStandings(orgId, currentSeason);
}

export async function setNationalReported(
  orgId: string,
  email: string,
  reported: boolean,
  actor: string,
  nsbeMembershipId?: string,
): Promise<void> {
  const e = email.trim().toLowerCase();
  const currentSeason = await getConfigValue(orgId, "SEASON", "");
  const season = reported ? currentSeason : null;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: {
        nationalMemberReported: reported,
        ...(season !== null ? { membershipSeason: season } : {}),
        ...(reported && nsbeMembershipId !== undefined ? { nsbeMembershipId: nsbeMembershipId.trim() || null } : {}),
        ...(!reported ? { nsbeMembershipId: null } : {}),
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "report_national", target: e, detail: String(reported) });
  });
  invalidateStandings(orgId, currentSeason);
}

/**
 * Same "write house+proof together, leave houseVerifiedAt null (pending
 * review)" shape registerForEvent already applies inline for an unverified
 * member — used by signup completion and /account.
 *
 * Once houseVerifiedAt is set, this is a member-facing endpoint and MUST
 * reject the write server-side — a hidden "Edit" button (HouseSection.tsx
 * only renders one while unverified) is a UI nicety, not an access control.
 * The only path to change a verified House is an admin correction, see
 * correctHouse above.
 */
export async function setHouseAssignment(
  orgId: string,
  email: string,
  house: string,
  houseProofFileId: string,
  actor: string,
): Promise<void> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } } });
  if (!user) throw new AppError("NOT_FOUND", "Member not found");
  if (user.houseVerifiedAt !== null) {
    throw new AppError("FORBIDDEN", "Your House is verified — contact an E-Board member to request a change.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { orgId_email: { orgId, email: e } }, data: { house, houseProofFileId } });
    await logAdminAction(tx, orgId, { actor, action: "set_house", target: e, detail: house });
  });
}

/**
 * Explicit "I haven't taken the test yet" from /account — clears any
 * unverified House (and its proof) so a member can back out of a partial or
 * previously-submitted assignment. Same verified-lock as setHouseAssignment
 * above. A no-op (no write, no AdminLog entry) when there's nothing to
 * clear — a fresh member choosing "skip" for the first time never had a
 * House to begin with.
 */
export async function clearHouseAssignment(orgId: string, email: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } } });
  if (!user) throw new AppError("NOT_FOUND", "Member not found");
  if (user.houseVerifiedAt !== null) {
    throw new AppError("FORBIDDEN", "Your House is verified — contact an E-Board member to request a change.");
  }
  if (user.house === null && user.houseProofFileId === null) return;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { orgId_email: { orgId, email: e } }, data: { house: null, houseProofFileId: null } });
    await logAdminAction(tx, orgId, { actor, action: "clear_house", target: e });
  });
}

export async function setResume(orgId: string, email: string, resumeFileId: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: { resumeFileId, resumeUpdatedAt: now, resumeConsentAt: now },
    });
    await logAdminAction(tx, orgId, { actor, action: "set_resume", target: e });
  });
}

/** Withdraws consent — detaches the resume (clears the pointer + consent timestamp). Doesn't delete the underlying UploadedFile row/bytes: a hard-delete-from-storage feature is out of scope here. */
export async function removeResume(orgId: string, email: string, actor: string): Promise<void> {
  const e = email.trim().toLowerCase();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: { resumeFileId: null, resumeUpdatedAt: null, resumeConsentAt: null },
    });
    await logAdminAction(tx, orgId, { actor, action: "remove_resume", target: e });
  });
}

export interface ProfileFieldsInput {
  firstName?: string;
  lastName?: string;
  studentId?: string;
  classification?: Classification;
  major?: string;
  majorOther?: string;
  phone?: string;
  personalEmail?: string;
  tshirtSize?: ShirtSize;
  nsbeMembershipId?: string;
}

/** Shared by self-service (/account) and admin (/admin/members/[id]) profile edits — same AdminLog action either way, so edits are traceable regardless of actor. */
export async function updateProfileFields(
  orgId: string,
  email: string,
  fields: ProfileFieldsInput,
  actor: string,
): Promise<Member> {
  const e = email.trim().toLowerCase();
  // Writing classification or major here is the same "confirmed for this
  // season" event as answering the check-in gap-filler question — stamp
  // profileSeason so getMissingFields doesn't immediately re-ask (Part: the
  // seasonal refresh applies no matter which surface wrote the value).
  const stampProfileSeason = fields.classification !== undefined || fields.major !== undefined;
  const season = stampProfileSeason ? await getConfigValue(orgId, "SEASON", "") : null;
  return prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: {
        ...(fields.firstName !== undefined ? { firstName: fields.firstName } : {}),
        ...(fields.lastName !== undefined ? { lastName: fields.lastName } : {}),
        ...(fields.studentId !== undefined ? { studentId: fields.studentId } : {}),
        ...(fields.classification !== undefined ? { classification: classificationToDb(fields.classification) } : {}),
        ...(fields.major !== undefined ? { major: fields.major } : {}),
        ...(fields.majorOther !== undefined ? { majorOther: fields.majorOther } : {}),
        ...(season !== null ? { profileSeason: season } : {}),
        ...(fields.phone !== undefined ? { phone: fields.phone || null } : {}),
        ...(fields.personalEmail !== undefined ? { personalEmail: fields.personalEmail || null } : {}),
        ...(fields.tshirtSize !== undefined ? { tshirtSize: shirtSizeToDb(fields.tshirtSize) } : {}),
        ...(fields.nsbeMembershipId !== undefined ? { nsbeMembershipId: fields.nsbeMembershipId || null } : {}),
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "update_profile", target: e });
    return userToMember(row);
  });
}

/** Self-service password change — verifies the current password first (unlike setPassword, used by the forced-setup-code flow, which trusts the caller already). */
export async function changePassword(orgId: string, email: string, currentPassword: string, newPassword: string): Promise<void> {
  const e = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email: e } } });
  if (!user) throw new AppError("NOT_FOUND", "Member not found");
  const ok = await verifyPassword(currentPassword, user.passwordHash);
  if (!ok) {
    throw new AppError("VALIDATION_FAILED", "Current password is incorrect", {
      fieldErrors: { currentPassword: "Current password is incorrect" },
    });
  }
  await setPassword(orgId, e, newPassword);
}

// ---------------------------------------------------------------------------
// Uploaded files — never publicly addressable, see lib/storage.ts and
// GET /api/files/[id]. This module never returns storageKey to a caller
// outside this file.
// ---------------------------------------------------------------------------

export interface CreateUploadedFileInput {
  orgId: string;
  userId: string;
  kind: FileKind;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}

export async function createUploadedFile(input: CreateUploadedFileInput): Promise<UploadedFile> {
  const row = await prisma.uploadedFile.create({
    data: {
      orgId: input.orgId,
      userId: input.userId,
      kind: fileKindToDb(input.kind),
      storageKey: input.storageKey,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
    },
  });
  return uploadedFileToDomain(row);
}

/**
 * Owner or EBOARD-or-above only — GET /api/files/[id]'s entire authorization
 * rule, pulled out as a pure predicate so it's directly unit-testable without
 * the Next.js request-scoped auth context repo.ts's other consumers need.
 */
export function canAccessFile(file: { ownerEmail: string }, requester: { email: string; role: Role }): boolean {
  return (
    file.ownerEmail.trim().toLowerCase() === requester.email.trim().toLowerCase() ||
    requester.role === "eboard" ||
    requester.role === "admin"
  );
}

/** Internal to the file-serving route only — carries storageKey, never exposed elsewhere. */
export async function getUploadedFileForServing(
  orgId: string,
  id: string,
): Promise<(UploadedFile & { storageKey: string; ownerEmail: string }) | null> {
  const row = await prisma.uploadedFile.findFirst({ where: { id, orgId }, include: { user: { select: { email: true } } } });
  if (!row) return null;
  return { ...uploadedFileToDomain(row), storageKey: row.storageKey, ownerEmail: row.user.email };
}

// ---------------------------------------------------------------------------
// Event categories (Part 1) — replaces the old flat PointSystem. Full CRUD
// from /admin/settings/categories; every point value is data, never
// hardcoded — see lib/points.ts memberPointsFor/eboardAwardFor, which only
// ever read category.memberPoints/eboardEligible fresh at call time.
// ---------------------------------------------------------------------------

export async function getEventCategories(orgId: string): Promise<EventCategory[]> {
  const rows = await prisma.eventCategory.findMany({ where: { orgId }, orderBy: { sortOrder: "asc" } });
  return rows.map(eventCategoryToDomain);
}

export async function getEventCategory(orgId: string, id: string): Promise<EventCategory | null> {
  const row = await prisma.eventCategory.findFirst({ where: { id, orgId } });
  return row ? eventCategoryToDomain(row) : null;
}

export interface EventCategoryInput {
  code: string;
  name: string;
  shortName: string;
  tier: number | null;
  memberPoints: number;
  examples?: string;
  countsForMonthly?: boolean;
  eboardEligible?: boolean;
  audience?: Audience;
  active?: boolean;
  sortOrder?: number;
}

export async function createEventCategory(orgId: string, input: EventCategoryInput, actor: string): Promise<EventCategory> {
  return prisma.$transaction(async (tx) => {
    let row: EventCategoryModel;
    try {
      row = await tx.eventCategory.create({
        data: {
          orgId,
          code: input.code,
          name: input.name,
          shortName: input.shortName,
          tier: input.tier,
          memberPoints: input.memberPoints,
          examples: input.examples || null,
          countsForMonthly: input.countsForMonthly ?? true,
          eboardEligible: input.eboardEligible ?? true,
          audience: audienceToDb(input.audience ?? "all"),
          active: input.active ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new AppError("VALIDATION_FAILED", "A category with this code already exists.", {
          fieldErrors: { code: "A category with this code already exists." },
        });
      }
      throw err;
    }
    await logAdminAction(tx, orgId, { actor, action: "create_category", target: row.id, detail: input.code });
    return eventCategoryToDomain(row);
  });
}

/**
 * Point-value edits are never blocked (they're data, not schema) — the admin
 * UI is responsible for warning that this changes every past registration's
 * DERIVED total with no backfill (see lib/points.ts memberPointsFor) and
 * offering a standings snapshot first.
 */
export async function updateEventCategory(
  orgId: string,
  id: string,
  input: Partial<EventCategoryInput>,
  actor: string,
): Promise<EventCategory> {
  const category = await prisma.$transaction(async (tx) => {
    const existing = await tx.eventCategory.findFirst({ where: { id, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Category not found");
    const row = await tx.eventCategory.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
        ...(input.tier !== undefined ? { tier: input.tier } : {}),
        ...(input.memberPoints !== undefined ? { memberPoints: input.memberPoints } : {}),
        ...(input.examples !== undefined ? { examples: input.examples || null } : {}),
        ...(input.countsForMonthly !== undefined ? { countsForMonthly: input.countsForMonthly } : {}),
        ...(input.eboardEligible !== undefined ? { eboardEligible: input.eboardEligible } : {}),
        ...(input.audience !== undefined ? { audience: audienceToDb(input.audience) } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await logAdminAction(tx, orgId, {
      actor,
      action: "update_category",
      target: id,
      detail: input.memberPoints !== undefined ? `memberPoints -> ${input.memberPoints}` : input.code,
    });
    return eventCategoryToDomain(row);
  });
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
  return category;
}

// ---------------------------------------------------------------------------
// NSBE Week / event groups (Part 2). The completion bonus is derived at read
// time (see lib/points.ts groupBonusFor/isGroupComplete) — nothing here ever
// stores a computed bonus value.
// ---------------------------------------------------------------------------

export async function getEventGroups(orgId: string): Promise<EventGroup[]> {
  const rows = await prisma.eventGroup.findMany({
    where: { orgId },
    include: { events: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(eventGroupToDomain);
}

export async function getEventGroup(orgId: string, id: string): Promise<EventGroup | null> {
  const row = await prisma.eventGroup.findFirst({ where: { id, orgId }, include: { events: { select: { id: true } } } });
  return row ? eventGroupToDomain(row) : null;
}

export interface CreateEventGroupInput {
  orgId: string;
  name: string;
  slug?: string;
  kind?: GroupKind;
  expectedEventCount?: number;
  bonusTiers: BonusTier[];
  createdBy: string;
}

export async function createEventGroup(input: CreateEventGroupInput): Promise<EventGroup> {
  const { orgId } = input;
  return prisma.$transaction(async (tx) => {
    const base = slugify(input.slug || input.name);
    let slug = base;
    let n = 2;
    for (;;) {
      const existing = await tx.eventGroup.findUnique({ where: { orgId_slug: { orgId, slug } } });
      if (!existing) break;
      slug = `${base}-${n++}`;
    }
    const row = await tx.eventGroup.create({
      data: {
        orgId,
        name: input.name,
        slug,
        kind: groupKindToDb(input.kind ?? "nsbe_week"),
        expectedEventCount: input.expectedEventCount ?? 5,
        bonusTiers: input.bonusTiers as unknown as Prisma.InputJsonValue,
      },
      include: { events: { select: { id: true } } },
    });
    await logAdminAction(tx, orgId, { actor: input.createdBy, action: "create_group", target: row.id, detail: input.name });
    return eventGroupToDomain(row);
  });
}

export async function updateEventGroupTiers(
  orgId: string,
  id: string,
  bonusTiers: BonusTier[],
  actor: string,
): Promise<EventGroup> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.eventGroup.findFirst({ where: { id, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Group not found");
    const row = await tx.eventGroup.update({
      where: { id },
      data: { bonusTiers: bonusTiers as unknown as Prisma.InputJsonValue },
      include: { events: { select: { id: true } } },
    });
    await logAdminAction(tx, orgId, { actor, action: "update_group_tiers", target: id });
    return eventGroupToDomain(row);
  });
}

/** Assigns (or, with groupId null, removes) an event to/from a group — the /admin/groups matrix UI's write path onto Event.groupId. */
export async function setEventGroup(orgId: string, eventId: string, groupId: string | null, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: eventId, orgId } });
    if (!event) throw new AppError("NOT_FOUND", "Event not found");
    if (groupId) {
      const group = await tx.eventGroup.findFirst({ where: { id: groupId, orgId } });
      if (!group) throw new AppError("NOT_FOUND", "Group not found");
    }
    await tx.event.update({ where: { id: eventId }, data: { groupId } });
    await logAdminAction(tx, orgId, { actor, action: "set_event_group", target: eventId, detail: groupId ?? "none" });
  });
}

/** The manual override (Part 2) — settles the bonus against whatever events actually exist, for when a planned event in the set is canceled and never happens. */
export async function finalizeEventGroup(orgId: string, id: string, actor: string): Promise<EventGroup> {
  const group = await prisma.$transaction(async (tx) => {
    const existing = await tx.eventGroup.findFirst({ where: { id, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Group not found");
    const actorUser = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
      select: { id: true },
    });
    const row = await tx.eventGroup.update({
      where: { id },
      data: { finalizedAt: new Date(), finalizedById: actorUser?.id ?? null },
      include: { events: { select: { id: true } } },
    });
    await logAdminAction(tx, orgId, { actor, action: "finalize_group", target: id });
    return eventGroupToDomain(row);
  });
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
  return group;
}

export interface NsbeWeekProgress {
  groupName: string;
  attended: number;
  expectedEventCount: number;
  bonusTiers: BonusTier[];
}

/**
 * The FIRST not-yet-complete group, if any — the "NSBE Week: 3 of 5
 * attended" banner. Deliberately shows nothing once the group completes: the
 * spec is explicit that a provisional "+3" that later becomes "+5" (or
 * disappears) is worse than showing nothing, so the banner itself disappears
 * at completion and the real bonus takes over in the point breakdown.
 */
export async function getActiveNsbeWeekProgress(
  orgId: string,
  email: string,
  now: Date = new Date(),
): Promise<NsbeWeekProgress | null> {
  const e = email.trim().toLowerCase();
  const groups = await prisma.eventGroup.findMany({
    where: { orgId },
    include: { events: { select: { id: true, status: true, closesAt: true } } },
    orderBy: { createdAt: "desc" },
  });

  for (const g of groups) {
    if (g.events.length === 0) continue;
    const groupInput: GroupBonusInput = {
      events: g.events.map((ev) => ({ eventId: ev.id, status: eventStatusFromDb(ev.status), closesAt: ev.closesAt })),
      bonusTiers: (g.bonusTiers as unknown as BonusTier[] | null) ?? [],
      finalizedAt: g.finalizedAt,
    };
    if (isGroupComplete(groupInput, now)) continue;

    const attended = await prisma.registration.count({
      where: { eventId: { in: g.events.map((ev) => ev.id) }, user: { email: e } },
    });
    return { groupName: g.name, attended, expectedEventCount: g.expectedEventCount, bonusTiers: groupInput.bonusTiers };
  }
  return null;
}

export interface GroupAttendanceRow {
  email: string;
  firstName: string;
  lastName: string;
  attendedEventIds: string[];
  bonus: number;
}

/** The per-member attendance matrix (members x this group's events) for /admin/groups — plus each member's CURRENT bonus (0 before completion, per groupBonusFor). */
export async function getGroupAttendanceMatrix(
  orgId: string,
  groupId: string,
  now: Date = new Date(),
): Promise<GroupAttendanceRow[]> {
  const group = await prisma.eventGroup.findFirst({
    where: { id: groupId, orgId },
    include: { events: { select: { id: true, status: true, closesAt: true } } },
  });
  if (!group) throw new AppError("NOT_FOUND", "Group not found");

  const groupInput: GroupBonusInput = {
    events: group.events.map((e) => ({ eventId: e.id, status: eventStatusFromDb(e.status), closesAt: e.closesAt })),
    bonusTiers: (group.bonusTiers as unknown as BonusTier[] | null) ?? [],
    finalizedAt: group.finalizedAt,
  };
  const eventIds = group.events.map((e) => e.id);

  const [members, registrations] = await Promise.all([
    getMembers(orgId),
    eventIds.length > 0
      ? prisma.registration.findMany({ where: { eventId: { in: eventIds } }, include: { user: { select: { email: true } } } })
      : Promise.resolve([]),
  ]);

  const byEmail = new Map<string, string[]>();
  for (const r of registrations) {
    const list = byEmail.get(r.user.email) ?? [];
    list.push(r.eventId);
    byEmail.set(r.user.email, list);
  }

  return members
    .filter((m) => m.role === "general")
    .map((m) => {
      const attendedEventIds = byEmail.get(m.email) ?? [];
      return {
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
        attendedEventIds,
        bonus: groupBonusFor(attendedEventIds.map((eventId) => ({ eventId })), groupInput, now),
      };
    });
}

// ---------------------------------------------------------------------------
// Bonus awards (Part 3) — game/competition bonuses, manual awards, and
// materialized monthly champions. GAME_COMPETITION and MONTHLY_CHAMPION are
// capped/deduplicated by PointAward's own @@unique constraints, never by
// application logic — a duplicate throws a real P2002.
// ---------------------------------------------------------------------------

export async function getPointAwardsForUser(orgId: string, email: string): Promise<PointAward[]> {
  const e = email.trim().toLowerCase();
  const rows = await prisma.pointAward.findMany({
    where: { orgId, user: { email: e } },
    include: { user: { select: { email: true } } },
    orderBy: { awardedAt: "desc" },
  });
  return rows.map(pointAwardToDomain);
}

/** +1 (or whatever `points` is configured to) per member per event — capped by the (orgId,userId,kind,eventId) unique constraint, not by this loop. Only registrants for the event are valid picks in the admin UI; a non-registrant email here just fails to find a matching user or, if it somehow does, is a data-entry mistake this function doesn't second-guess. */
export async function awardGameBonus(
  orgId: string,
  eventId: string,
  emails: string[],
  points: number,
  reason: string,
  actor: string,
): Promise<{ awarded: string[]; skipped: string[] }> {
  const actorUser = await prisma.user.findUnique({
    where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
    select: { id: true },
  });

  const awarded: string[] = [];
  const skipped: string[] = [];
  for (const rawEmail of emails) {
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { orgId_email: { orgId, email } } });
    if (!user) {
      skipped.push(email);
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.pointAward.create({
          data: {
            orgId,
            userId: user.id,
            kind: DbAwardKind.GAME_COMPETITION,
            points,
            eventId,
            reason,
            awardedById: actorUser?.id ?? null,
          },
        });
        await logAdminAction(tx, orgId, {
          actor,
          action: "award_game_bonus",
          target: `${eventId}:${email}`,
          detail: String(points),
        });
      });
      awarded.push(email);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        skipped.push(email);
        continue;
      }
      throw err;
    }
  }
  if (awarded.length > 0) invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
  return { awarded, skipped };
}

export interface CreateManualAwardInput {
  orgId: string;
  email: string;
  points: number;
  reason: string;
  actor: string;
}

export async function createManualAward(input: CreateManualAwardInput): Promise<PointAward> {
  const { orgId } = input;
  const email = input.email.trim().toLowerCase();
  const award = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { orgId_email: { orgId, email } } });
    if (!user) throw new AppError("NOT_FOUND", "Member not found");
    const actorUser = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: input.actor.trim().toLowerCase() } },
      select: { id: true },
    });
    const row = await tx.pointAward.create({
      data: {
        orgId,
        userId: user.id,
        kind: DbAwardKind.MANUAL,
        points: input.points,
        reason: input.reason,
        awardedById: actorUser?.id ?? null,
      },
      include: { user: { select: { email: true } } },
    });
    await logAdminAction(tx, orgId, {
      actor: input.actor,
      action: "award_manual",
      target: email,
      detail: `${input.points}: ${input.reason}`,
    });
    return pointAwardToDomain(row);
  });
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
  return award;
}

/** Revoking is the only path from here forward — an award is never deleted, so the audit trail (who granted it, who took it back, why) survives. Standings re-derive on the next read; nothing to backfill. */
export async function revokePointAward(orgId: string, id: string, actor: string, note: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.pointAward.findFirst({ where: { id, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Award not found");
    const actorUser = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
      select: { id: true },
    });
    await tx.pointAward.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById: actorUser?.id ?? null, revokeNote: note },
    });
    await logAdminAction(tx, orgId, { actor, action: "revoke_award", target: id, detail: note });
  });
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
}

export async function getMonthlyChampionConfig(orgId: string): Promise<{ minEvents: number }> {
  const raw = await getConfigValue(orgId, "MONTHLY_CHAMPION_MIN_EVENTS", "2");
  const parsed = Number(raw);
  return { minEvents: Number.isFinite(parsed) && parsed > 0 ? parsed : 2 };
}

export interface MonthlyChampionCandidate {
  email: string;
  firstName: string;
  lastName: string;
  count: number;
}

export interface MonthlyChampionPreview {
  month: string;
  /** What calculateMonthlyChampions would award if run right now. */
  champions: MonthlyChampionCandidate[];
  /** Already-materialized (non-revoked) champions for this month — the "diff" shown before a recalculation. */
  alreadyMaterialized: string[];
}

/** Read-only — the "recalculating shows a diff" confirmation reads this before calculateMonthlyChampions actually writes anything. */
export async function previewMonthlyChampions(
  orgId: string,
  month: string,
  now: Date = new Date(),
): Promise<MonthlyChampionPreview> {
  const [attendance, members, minEventsConfig, existingAwards] = await Promise.all([
    getAttendance(orgId),
    getMembers(orgId),
    getMonthlyChampionConfig(orgId),
    prisma.pointAward.findMany({
      where: { orgId, kind: DbAwardKind.MONTHLY_CHAMPION, periodMonth: month, revokedAt: null },
      include: { user: { select: { email: true } } },
    }),
  ]);
  const champions = monthlyChampions(attendance, month, minEventsConfig, now);
  const memberByEmail = new Map(members.map((m) => [m.email, m]));
  return {
    month,
    champions: champions.map((c) => ({
      email: c.email,
      firstName: memberByEmail.get(c.email)?.firstName ?? "",
      lastName: memberByEmail.get(c.email)?.lastName ?? "",
      count: c.count,
    })),
    alreadyMaterialized: existingAwards.map((a) => a.user.email),
  };
}

export interface CalculateMonthlyChampionsResult {
  month: string;
  awarded: string[];
  revoked: string[];
  unchanged: boolean;
}

/**
 * Idempotent: re-running for a month whose champion set hasn't changed
 * awards/revokes nothing. If the set DID change (e.g. a category edit
 * changed who qualifies, or a late correction), champions no longer at the
 * max are revoked and new ones are awarded — the (orgId,userId,kind,
 * periodMonth) unique constraint is what actually stops a still-champion
 * member from ever being double-awarded.
 */
export async function calculateMonthlyChampions(
  orgId: string,
  month: string,
  points: number,
  actor: string,
  now: Date = new Date(),
): Promise<CalculateMonthlyChampionsResult> {
  const [attendance, minEventsConfig, existing] = await Promise.all([
    getAttendance(orgId),
    getMonthlyChampionConfig(orgId),
    prisma.pointAward.findMany({
      where: { orgId, kind: DbAwardKind.MONTHLY_CHAMPION, periodMonth: month, revokedAt: null },
      include: { user: { select: { email: true } } },
    }),
  ]);
  const champions = monthlyChampions(attendance, month, minEventsConfig, now);
  const championEmails = new Set(champions.map((c) => c.email));
  const existingEmails = new Set(existing.map((a) => a.user.email));

  const toAward = champions.filter((c) => !existingEmails.has(c.email));
  const toRevoke = existing.filter((a) => !championEmails.has(a.user.email));

  const actorUser = await prisma.user.findUnique({
    where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
    select: { id: true },
  });

  const awarded: string[] = [];
  const revoked: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const award of toRevoke) {
      await tx.pointAward.update({
        where: { id: award.id },
        data: { revokedAt: now, revokedById: actorUser?.id ?? null, revokeNote: "Superseded by recalculation" },
      });
      revoked.push(award.user.email);
    }
    for (const champion of toAward) {
      const user = await tx.user.findUnique({ where: { orgId_email: { orgId, email: champion.email } } });
      if (!user) continue;
      await tx.pointAward.create({
        data: {
          orgId,
          userId: user.id,
          kind: DbAwardKind.MONTHLY_CHAMPION,
          points,
          periodMonth: month,
          reason: `Monthly Engagement Champion — ${month} (${champion.count} events)`,
          awardedById: actorUser?.id ?? null,
        },
      });
      awarded.push(champion.email);
    }
    if (toAward.length > 0 || toRevoke.length > 0) {
      await logAdminAction(tx, orgId, {
        actor,
        action: "calculate_monthly_champions",
        target: month,
        detail: `${toAward.length} awarded, ${toRevoke.length} revoked`,
      });
    }
  });

  if (awarded.length > 0 || revoked.length > 0) invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
  return { month, awarded, revoked, unchanged: toAward.length === 0 && toRevoke.length === 0 };
}

// ---------------------------------------------------------------------------
// Write paths
// ---------------------------------------------------------------------------

export interface CoreFormConfig {
  majors: string[];
  /** Structured — code/name/color, not the old pipe-delimited string. See lib/houses.ts. */
  houses: House[];
}

/** Config.MAJORS_LIST (still pipe-delimited) and Config.HOUSES_LIST (JSON — see lib/houses.ts), parsed for server-side validation. */
export async function getCoreFormConfig(orgId: string): Promise<CoreFormConfig> {
  const [majorsRaw, housesRaw] = await Promise.all([
    getConfigValue(orgId, "MAJORS_LIST", ""),
    getConfigValue(orgId, "HOUSES_LIST", ""),
  ]);
  const split = (s: string) => s.split("|").map((v) => v.trim()).filter(Boolean);
  return { majors: split(majorsRaw), houses: parseHouses(housesRaw) };
}

/** CoreFormConfig plus the three link targets the core form's descriptions reference, and the current season (drives the dues/national re-ask — see CoreCheckInForm.tsx) — for rendering, not validation. */
export async function getCoreFormUiConfig(
  orgId: string,
): Promise<
  CoreFormConfig & {
    membershipSiteUrl: string;
    houseTestUrl: string;
    nationalMembershipUrl: string;
    currentSeason: string;
  }
> {
  const [core, membershipSiteUrl, houseTestUrl, nationalMembershipUrl, currentSeason] = await Promise.all([
    getCoreFormConfig(orgId),
    getConfigValue(orgId, "MEMBERSHIP_SITE_URL", ""),
    getConfigValue(orgId, "HOUSE_TEST_URL", ""),
    getConfigValue(orgId, "NATIONAL_MEMBERSHIP_URL", DEFAULT_NATIONAL_MEMBERSHIP_URL),
    getConfigValue(orgId, "SEASON", ""),
  ]);
  return { ...core, membershipSiteUrl, houseTestUrl, nationalMembershipUrl, currentSeason };
}

export interface RegisterForEventInput {
  orgId: string;
  /** Must come from the authenticated session — never trust an email in the request body. */
  email: string;
  eventId: string;
  /**
   * The rotating check-in code (see lib/code.ts), re-verified here against
   * receivedAt regardless of what /api/events/[id]/verify-code already said —
   * that endpoint only gates the form's UI, this is the actual boundary.
   */
  code: string;
  /** Answers to the static core form — see lib/core-form.ts. Validated + written back to the User row. */
  core: unknown;
  /** Answers to this event's admin-added extra questions (≤5) — see lib/forms.ts. */
  extra: unknown;
  /**
   * The instant the request arrived at the server — captured by the caller
   * BEFORE any awaits (auth, body parsing), not defaulted in here.
   */
  receivedAt?: Date;
  /** For the per-event brute-force failure log only (see verifyEventCodeOrThrow) — never used to key a rate limit here (the member is already keyed by email/userId at the UX-gate route). */
  ip?: string;
}

export interface RegisterForEventResult {
  pointsAwarded: number;
  total: number;
  rank: number | null;
  /** Whether this member's points count toward standings right now — see lib/points.ts isEligible. */
  eligible: boolean;
  /** Non-null whenever the registrant is currently EBOARD, on ANY event they earn eboard credit for — never persisted, see lib/points.ts eboardAwardFor. */
  eboardPointsAwarded: number | null;
}

export async function registerForEvent(input: RegisterForEventInput): Promise<RegisterForEventResult> {
  const { orgId } = input;
  const email = input.email.trim().toLowerCase();
  const now = input.receivedAt ?? new Date();

  const [eventRow, user, coreFormConfig, season, eboardPointValue, eboardTrackEnabledRaw] = await Promise.all([
    prisma.event.findFirst({ where: { id: input.eventId, orgId }, include: EVENT_INCLUDE }),
    prisma.user.findUnique({ where: { orgId_email: { orgId, email } } }),
    getCoreFormConfig(orgId),
    getConfigValue(orgId, "SEASON", ""),
    getConfigValue(orgId, "EBOARD_POINT_VALUE", "1"),
    getConfigValue(orgId, "EBOARD_TRACK_ENABLED", "true"),
  ]);
  const eboardConfig = { EBOARD_POINT_VALUE: eboardPointValue, EBOARD_TRACK_ENABLED: eboardTrackEnabledRaw === "true" };

  if (!eventRow) throw new AppError("NOT_FOUND", "Event not found");
  const event = eventToDomain(eventRow);

  // 1. The registration window — see lib/points.ts isOpen.
  if (!isOpen(event, now)) {
    throw new AppError("EVENT_CLOSED_DURING_SUBMIT", "This event is no longer open for registration");
  }

  // 2. The rotating check-in code — re-verified here against receivedAt no
  // matter what /api/events/[id]/verify-code already said. That endpoint
  // only gates the form's render; this is the actual security boundary. Also
  // enforces the per-event brute-force lock (see verifyEventCodeOrThrow) —
  // the real security boundary is exactly where a lock has to bite too, or
  // an attacker skips the UX-gate route entirely and this is unlimited.
  await verifyEventCodeOrThrow({ orgId, eventId: event.eventId, code: input.code, now, who: email, ip: input.ip ?? "unknown" });

  if (!user) throw new AppError("UNAUTHENTICATED", "You must be signed in");
  if (statusFromDb(user.status) !== "active") {
    throw new AppError("ACCOUNT_NOT_ACTIVE", "Your account isn't active yet — see the pending page for next steps");
  }

  // Role always comes from the roster, never the client.
  const role: Role = roleFromDb(user.role);

  // EBOARD_ONLY events are 403 for anyone else — server-side defense in
  // depth; the page itself already calls next/navigation's forbidden().
  const canSeeEboardOnly = role === "eboard" || role === "admin";
  if (event.audience === "eboard_only" && !canSeeEboardOnly) {
    throw new AppError("FORBIDDEN", "This event is for E-Board only");
  }
  const reduced = event.audience === "eboard_only";

  // 3. Duplicate check — a friendly, explicit early error rather than
  // waiting for the (eventId, userId) unique constraint to reject the write
  // at the very end, after the user has answered every question. The unique
  // constraint stays in place below as the real dedupe guarantee (this read
  // has the usual check-then-write race under concurrent double-submits).
  const existingRegistration = await prisma.registration.findUnique({
    where: { eventId_userId: { eventId: event.eventId, userId: user.id } },
  });
  if (existingRegistration) {
    throw new AppError("ALREADY_REGISTERED", "You have already registered for this event");
  }

  // 4. Core-form validation — writes back to the User row (Part 2/3 of the
  // spec). getMissingFields (lib/core-form.ts) is the SOLE source of truth
  // for what's required: EBOARD_ONLY events get only genuinely-missing name
  // fields (Part 6) — officers re-confirming dues/House/resume/
  // classification/major/studentId at every weekly meeting is how a form
  // gets abandoned. A Config.SEASON bump re-arms classification/major (via
  // profileSeason) and dues/national (via membershipSeason) with no script.
  const missingFields = new Set(reduced ? [] : getMissingFields(userToMember(user), event, { SEASON: season }));
  const duesAlreadyReported = !missingFields.has("duesPaid");
  const nationalAlreadyReported = !missingFields.has("nationalMember");
  const fullCore = reduced
    ? null
    : validateCoreAnswers(
        { majors: coreFormConfig.majors, houses: coreFormConfig.houses, missing: missingFields },
        input.core,
      );
  const reducedCore = reduced ? validateReducedCoreAnswers(input.core) : null;

  // A newly-submitted House/Resume file must belong to this user — never trust a client-supplied fileId blindly.
  if (fullCore) {
    const fileIdsToCheck = [
      fullCore.houseProofFileId,
      fullCore.resumeAction === "upload" ? fullCore.resumeFileId : undefined,
    ].filter((id): id is string => Boolean(id));
    if (fileIdsToCheck.length > 0) {
      const owned = await prisma.uploadedFile.count({ where: { id: { in: fileIdsToCheck }, userId: user.id, orgId } });
      if (owned !== fileIdsToCheck.length) {
        throw new AppError("VALIDATION_FAILED", "One of your uploaded files couldn't be found. Try uploading again.");
      }
    }
  }

  // 5. Extra-question validation — unchanged from before, still ≤5 FormField rows.
  const fields = (await prisma.formField.findMany({ where: { eventId: event.eventId }, orderBy: { order: "asc" } })).map(
    formFieldToDomain,
  );
  const extraAnswers = validateAnswers(fields, input.extra);

  // 6. Points. Member track: always the full amount regardless of
  // eligibility (see lib/points.ts isEligible) — this is a historical
  // snapshot only (see AttendanceRecord.pointsAwarded); the leaderboard
  // re-derives from the live category/override on every read instead. E-Board
  // track: entirely separate scoring, never stored — see lib/points.ts
  // eboardAwardFor. This applies on ANY event an EBOARD member attends, not
  // just EBOARD_ONLY ones (a GBM counts toward the internal track too, per
  // Part 3's own example).
  const pointsAwarded = memberPointsFor({ role }, event, event.category);
  const eboardPointsAwarded = canSeeEboardOnly ? eboardAwardFor(role, event.category, eboardConfig) : null;

  // 7. Every check passed — write. The (eventId, userId) unique constraint is
  // still the actual dedupe guarantee (belt and suspenders on top of the
  // explicit check above) — it closes the check-then-write race that check
  // alone can't.
  // effectiveDuesPaid/effectiveNationalMember fold in the "already reported"
  // case (question wasn't asked, so nothing was submitted — the true current
  // value is what duesAlreadyReported/nationalAlreadyReported already proved).
  const effectiveDuesPaid = fullCore ? (duesAlreadyReported ? true : fullCore.duesPaid === true) : null;
  const effectiveNationalMember = fullCore ? (nationalAlreadyReported ? true : fullCore.nationalMember === true) : null;
  // Stamp membershipSeason only on a transition to true THIS submission —
  // answering "No" (or the question not being asked at all) never touches it.
  const stampSeason =
    fullCore !== null &&
    ((!duesAlreadyReported && fullCore.duesPaid === true) || (!nationalAlreadyReported && fullCore.nationalMember === true));
  // Same rule, for classification/major -> profileSeason: only stamped when
  // one of them was actually asked (and therefore submitted) this time.
  const stampProfileSeason = fullCore !== null && (fullCore.classification !== undefined || fullCore.major !== undefined);

  const answerRows = serializeAnswers(fields, extraAnswers);
  let eligible = false;
  try {
    await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: user.id },
        data: fullCore
          ? {
              firstName: fullCore.firstName,
              lastName: fullCore.lastName,
              studentId: fullCore.studentId,
              phone: fullCore.phone,
              personalEmail: fullCore.personalEmail,
              // classification/major are only in the payload when
              // getMissingFields asked for them — omit the key entirely
              // otherwise so the existing (already-current-for-this-season)
              // value is left untouched.
              ...(fullCore.classification !== undefined ? { classification: classificationToDb(fullCore.classification) } : {}),
              ...(fullCore.major !== undefined
                ? {
                    major: fullCore.major === "Other" ? fullCore.majorOther ?? null : fullCore.major,
                    majorOther: fullCore.major === "Other" ? fullCore.majorOther ?? null : null,
                  }
                : {}),
              ...(stampProfileSeason ? { profileSeason: season } : {}),
              // Dues/national are only in the payload when the question was
              // actually asked (Part 2's persistent re-ask) — omit the key
              // entirely otherwise so the existing DB value (already true)
              // is left untouched.
              ...(!duesAlreadyReported ? { duesPaidReported: fullCore.duesPaid, duesReportedAt: now } : {}),
              ...(!nationalAlreadyReported
                ? { nationalMemberReported: fullCore.nationalMember, nsbeMembershipId: fullCore.nsbeMembershipId ?? null }
                : fullCore.nsbeMembershipId !== undefined
                  ? // National was already reported — this is the nsbeMembershipId-only gap-filler case (Part: id blank on file, asked on its own).
                    { nsbeMembershipId: fullCore.nsbeMembershipId || null }
                  : {}),
              ...(stampSeason ? { membershipSeason: season } : {}),
              // A House and its screenshot are written TOGETHER, or not at
              // all — see buildCoreFormSchema's house superRefine (Part 1):
              // a skip (or a partial submission the schema didn't require)
              // leaves house untouched, same as answering "No" used to.
              ...(user.houseVerifiedAt === null && fullCore.house && fullCore.houseProofFileId
                ? { house: fullCore.house, houseProofFileId: fullCore.houseProofFileId }
                : {}),
              ...(fullCore.resumeAction === "upload" && fullCore.resumeFileId
                ? { resumeFileId: fullCore.resumeFileId, resumeUpdatedAt: now, resumeConsentAt: now }
                : {}),
            }
          : // Reduced form (Part 6) — confirms identity only, nothing else on the User row changes.
            { firstName: reducedCore!.firstName, lastName: reducedCore!.lastName },
      });
      eligible = fullCore ? isEligible(userToMember(updatedUser), season) : false;

      const registration = await tx.registration.create({
        data: {
          eventId: event.eventId,
          userId: user.id,
          pointsAwarded,
          roleAtTime: roleToDb(role),
          source: DbSource.FORM,
          // Reduced-form (EBOARD_ONLY) registrations leave these null — the
          // core form never asked, same precedent as guest registrations.
          // coreFormVersion is still stamped either way; that combination
          // (version present, snapshot fields null) is what makes a reduced
          // submission distinguishable in exports without a new column.
          // Snapshotted from updatedUser (the post-write, always-current
          // value) rather than fullCore directly — classification/major
          // are only in fullCore when this submission actually asked for
          // them (see stampProfileSeason above).
          classificationAtTime: fullCore ? updatedUser.classification : null,
          majorAtTime: fullCore ? updatedUser.major : null,
          duesReportedAtTime: effectiveDuesPaid,
          nationalReportedAtTime: effectiveNationalMember,
          coreFormVersion: CORE_FORM_VERSION,
          eligibleAtTime: fullCore ? eligible : null,
        },
      });
      const entries = Object.entries(answerRows);
      if (entries.length > 0) {
        await tx.answer.createMany({
          data: entries.map(([fieldKey, value]) => ({ registrationId: registration.id, fieldKey, value })),
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("ALREADY_REGISTERED", "You have already registered for this event");
    }
    throw err;
  }

  invalidateStandings(orgId, season);

  // 8. Derive the result fresh — rank depends on everyone else's standing too.
  const summary = await getMemberSummary(orgId, email);
  return { pointsAwarded, total: summary.points, rank: summary.rank, eligible, eboardPointsAwarded };
}

export interface RegisterGuestInput {
  orgId: string;
  eventId: string;
  firstName: string;
  lastName: string;
  email: string;
  affiliation: string;
  phone?: string;
  /** Same rotating code as member check-in (see lib/code.ts) — guests have no account, so this is the ONLY thing standing between a forwarded link and a fraudulent check-in. */
  code: string;
  extra: unknown;
  receivedAt?: Date;
  /** For the per-event brute-force failure log only (see verifyEventCodeOrThrow) — the guest UX-gate action already keys its own per-IP limiter separately. */
  ip?: string;
}

export interface RegisterGuestResult {
  pointsAwarded: 0;
}

/**
 * Guests never authenticate (see the guest_pass cookie in src/proxy.ts,
 * checked only against /guest/*) — find-or-create a lightweight GUEST-role
 * User by (orgId, email) so a returning guest doesn't get duplicated, then log
 * a zero-point Registration. passwordHash is left null: not a weak/unguessable
 * hash, no hash at all, so lib/auth.ts authorize() can reject role GUEST /
 * null passwordHash outright rather than relying on a compare ever failing.
 * Guests never appear in standings (computeStandings filters to role general).
 */
export async function registerGuest(input: RegisterGuestInput): Promise<RegisterGuestResult> {
  const { orgId } = input;
  const email = input.email.trim().toLowerCase();
  const now = input.receivedAt ?? new Date();

  const fieldErrors: Record<string, string> = {};
  if (!input.firstName.trim()) fieldErrors.firstName = "Required";
  if (!input.lastName.trim()) fieldErrors.lastName = "Required";
  if (!email || !email.includes("@")) fieldErrors.email = "Enter a valid email";
  if (Object.keys(fieldErrors).length > 0) {
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fieldErrors });
  }

  const eventRow = await prisma.event.findFirst({ where: { id: input.eventId, orgId }, include: EVENT_INCLUDE });
  if (!eventRow) throw new AppError("NOT_FOUND", "Event not found");
  const event = eventToDomain(eventRow);
  // EBOARD_ONLY events aren't for guests — the page already excludes them from the feed; this is defense in depth for a direct POST.
  if (event.audience === "eboard_only") throw new AppError("NOT_FOUND", "Event not found");
  if (!isOpen(event, now)) {
    throw new AppError("EVENT_CLOSED_DURING_SUBMIT", "This event is no longer open for registration");
  }
  // Real security boundary — same per-event brute-force lock as
  // registerForEvent (see verifyEventCodeOrThrow); guests have no account to
  // key a per-member limiter by, so this is the only thing standing between
  // a scripted attacker and an unlimited number of guest check-ins here.
  await verifyEventCodeOrThrow({ orgId, eventId: event.eventId, code: input.code, now, who: email, ip: input.ip ?? "unknown" });

  const fields = (await prisma.formField.findMany({ where: { eventId: event.eventId }, orderBy: { order: "asc" } })).map(
    formFieldToDomain,
  );
  const extraAnswers = validateAnswers(fields, input.extra);
  const answerRows = serializeAnswers(fields, extraAnswers);

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { orgId_email: { orgId, email } },
        update: {},
        create: {
          orgId,
          email,
          passwordHash: null,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          membership: input.affiliation.trim() || null,
          phone: input.phone?.trim() || null,
          role: DbRole.GUEST,
          status: DbUserStatus.ACTIVE,
        },
      });
      const registration = await tx.registration.create({
        data: {
          eventId: event.eventId,
          userId: user.id,
          pointsAwarded: 0,
          roleAtTime: DbRole.GUEST,
          source: DbSource.FORM,
        },
      });
      const entries = Object.entries(answerRows);
      if (entries.length > 0) {
        await tx.answer.createMany({
          data: entries.map(([fieldKey, value]) => ({ registrationId: registration.id, fieldKey, value })),
        });
      }
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("ALREADY_REGISTERED", "You've already checked in to this event");
    }
    throw err;
  }

  return { pointsAwarded: 0 };
}

export interface CreateEventInput {
  orgId: string;
  name: string;
  categoryId: string;
  groupId?: string | null;
  slug?: string;
  date?: Date | null;
  location?: string;
  description?: string;
  points?: number | null;
  durationMinutes?: number | null;
  audience?: Audience;
  createdBy: string;
}

export async function createEvent(input: CreateEventInput): Promise<Event> {
  const { orgId } = input;
  const defaultDuration = Number(await getConfigValue(orgId, "DEFAULT_EVENT_DURATION", "20"));
  return prisma.$transaction(async (tx) => {
    const category = await tx.eventCategory.findFirst({ where: { id: input.categoryId, orgId } });
    if (!category) throw new AppError("NOT_FOUND", "Category not found");

    const base = slugify(input.slug || `${input.name}-${(input.date ?? new Date()).getFullYear()}`);
    const slug = await uniqueSlug(tx, orgId, base);
    const creator = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: input.createdBy.trim().toLowerCase() } },
      select: { id: true },
    });

    const row = await tx.event.create({
      data: {
        orgId,
        slug,
        name: input.name,
        categoryId: category.id,
        groupId: input.groupId ?? null,
        date: input.date ?? new Date(),
        location: input.location || null,
        description: input.description || null,
        pointsOverride: input.points ?? null,
        status: DbEventStatus.DRAFT,
        durationMinutes: input.durationMinutes ?? defaultDuration,
        audience: audienceToDb(input.audience ?? "all"),
        createdById: creator?.id ?? null,
      },
      include: EVENT_INCLUDE,
    });
    await logAdminAction(tx, orgId, { actor: input.createdBy, action: "create_event", target: row.id, detail: input.name });
    return eventToDomain(row);
  });
}

export interface UpdateEventInput {
  orgId: string;
  eventId: string;
  name?: string;
  categoryId?: string;
  groupId?: string | null;
  slug?: string;
  date?: Date | null;
  location?: string;
  description?: string;
  points?: number | null;
  durationMinutes?: number | null;
  audience?: Audience;
  actor: string;
}

/** Edits an event's definition. Used for Draft/Scheduled events, before or between open windows — never touches Status/OpensAt/ClosesAt/OpenedBy. */
export async function updateEvent(input: UpdateEventInput): Promise<Event> {
  const { orgId } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: input.eventId, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Event not found");

    if (input.categoryId !== undefined) {
      const category = await tx.eventCategory.findFirst({ where: { id: input.categoryId, orgId } });
      if (!category) throw new AppError("NOT_FOUND", "Category not found");
    }
    if (input.groupId) {
      const group = await tx.eventGroup.findFirst({ where: { id: input.groupId, orgId } });
      if (!group) throw new AppError("NOT_FOUND", "Group not found");
    }

    const data: Prisma.EventUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.categoryId !== undefined) data.category = { connect: { id: input.categoryId } };
    if (input.groupId !== undefined) data.group = input.groupId ? { connect: { id: input.groupId } } : { disconnect: true };
    if (input.date !== undefined && input.date !== null) data.date = input.date;
    if (input.location !== undefined) data.location = input.location || null;
    if (input.description !== undefined) data.description = input.description || null;
    if (input.points !== undefined) data.pointsOverride = input.points;
    if (input.durationMinutes !== undefined) {
      data.durationMinutes = input.durationMinutes ?? Number(await getConfigValue(orgId, "DEFAULT_EVENT_DURATION", "20"));
    }
    if (input.audience !== undefined) data.audience = audienceToDb(input.audience);
    if (input.slug !== undefined && input.slug.trim() !== "") {
      data.slug = await uniqueSlug(tx, orgId, slugify(input.slug), existing.id);
    }

    const row = await tx.event.update({ where: { id: input.eventId }, data, include: EVENT_INCLUDE });
    await logAdminAction(tx, orgId, { actor: input.actor, action: "update_event", target: input.eventId });
    return eventToDomain(row);
  });
}

export async function cancelEvent(orgId: string, eventId: string, actor: string): Promise<Event> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: eventId, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Event not found");
    const row = await tx.event.update({ where: { id: eventId }, data: { status: DbEventStatus.CANCELED }, include: EVENT_INCLUDE });
    await logAdminAction(tx, orgId, { actor, action: "cancel_event", target: eventId });
    return eventToDomain(row);
  });
}

export interface OpenEventNowInput {
  orgId: string;
  eventId: string;
  openedBy: string;
  durationMinutes?: number;
  now?: Date;
}

const DEFAULT_OPEN_DURATION_MINUTES = 60;

export async function openEventNow(input: OpenEventNowInput): Promise<Event> {
  const { orgId } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: input.eventId, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Event not found");

    const now = input.now ?? new Date();
    const durationMinutes = input.durationMinutes ?? DEFAULT_OPEN_DURATION_MINUTES;
    const closesAt = new Date(now.getTime() + durationMinutes * 60_000);
    const opener = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: input.openedBy.trim().toLowerCase() } },
      select: { id: true },
    });

    const row = await tx.event.update({
      where: { id: input.eventId },
      data: {
        status: DbEventStatus.SCHEDULED,
        opensAt: now,
        closesAt,
        durationMinutes,
        openedById: opener?.id ?? null,
        openedAt: now,
      },
      include: EVENT_INCLUDE,
    });
    await logAdminAction(tx, orgId, { actor: input.openedBy, action: "open_event", target: input.eventId });
    return eventToDomain(row);
  });
}

export interface ExtendEventInput {
  orgId: string;
  eventId: string;
  extraMinutes: number;
  actor: string;
  now?: Date;
}

export async function extendEvent(input: ExtendEventInput): Promise<Event> {
  const { orgId } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: input.eventId, orgId }, include: EVENT_INCLUDE });
    if (!existing) throw new AppError("NOT_FOUND", "Event not found");

    const event = eventToDomain(existing);
    const now = input.now ?? new Date();
    const base = event.closesAt && event.closesAt.getTime() > now.getTime() ? event.closesAt : now;
    const newClosesAt = new Date(base.getTime() + input.extraMinutes * 60_000);
    const newDuration =
      event.opensAt !== null
        ? Math.round((newClosesAt.getTime() - event.opensAt.getTime()) / 60_000)
        : input.extraMinutes;

    const row = await tx.event.update({
      where: { id: input.eventId },
      data: { closesAt: newClosesAt, durationMinutes: newDuration },
      include: EVENT_INCLUDE,
    });
    await logAdminAction(tx, orgId, {
      actor: input.actor,
      action: "extend_event",
      target: input.eventId,
      detail: `+${input.extraMinutes} min`,
    });
    return eventToDomain(row);
  });
}

export interface CloseEventNowInput {
  orgId: string;
  eventId: string;
  actor: string;
  now?: Date;
}

export async function closeEventNow(input: CloseEventNowInput): Promise<Event> {
  const { orgId } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: input.eventId, orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Event not found");
    const now = input.now ?? new Date();
    const row = await tx.event.update({ where: { id: input.eventId }, data: { closesAt: now }, include: EVENT_INCLUDE });
    await logAdminAction(tx, orgId, { actor: input.actor, action: "close_event", target: input.eventId });
    return eventToDomain(row);
  });
}

export interface ReopenEventInput {
  orgId: string;
  eventId: string;
  reopenedBy: string;
  durationMinutes?: number;
  now?: Date;
}

/**
 * Reopens a closed event for more registrations. Allowed at any time, but
 * always audited: the prior open window is written to AdminLog before it's
 * overwritten on the Event row.
 */
export async function reopenEvent(input: ReopenEventInput): Promise<Event> {
  const { orgId } = input;
  return prisma.$transaction(async (tx) => {
    const existing = await tx.event.findFirst({ where: { id: input.eventId, orgId }, include: EVENT_INCLUDE });
    if (!existing) throw new AppError("NOT_FOUND", "Event not found");
    const prior = eventToDomain(existing);

    const now = input.now ?? new Date();
    const durationMinutes = input.durationMinutes ?? DEFAULT_OPEN_DURATION_MINUTES;
    const closesAt = new Date(now.getTime() + durationMinutes * 60_000);
    const reopener = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: input.reopenedBy.trim().toLowerCase() } },
      select: { id: true },
    });

    const row = await tx.event.update({
      where: { id: input.eventId },
      data: {
        status: DbEventStatus.SCHEDULED,
        opensAt: now,
        closesAt,
        durationMinutes,
        openedById: reopener?.id ?? null,
        openedAt: now,
        reopenNote: prior.opensAt && prior.closesAt ? `${prior.opensAt.toISOString()} – ${prior.closesAt.toISOString()}` : null,
      },
      include: EVENT_INCLUDE,
    });

    const priorWindow =
      prior.opensAt && prior.closesAt
        ? `${prior.opensAt.toISOString()} – ${prior.closesAt.toISOString()}`
        : "no prior window recorded";
    await logAdminAction(tx, orgId, {
      actor: input.reopenedBy,
      action: "reopen_event",
      target: input.eventId,
      detail: `Previous window: ${priorWindow}`,
    });
    return eventToDomain(row);
  });
}

export interface AddManualAttendanceInput {
  orgId: string;
  eventId: string;
  email: string;
  role?: Role;
  points?: number;
  source?: string;
  note: string;
  addedBy: string;
  now?: Date;
}

export async function addManualAttendance(input: AddManualAttendanceInput): Promise<AttendanceRecord> {
  const { orgId } = input;
  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();

  const [eventRow, user] = await Promise.all([
    prisma.event.findFirst({ where: { id: input.eventId, orgId }, include: EVENT_INCLUDE }),
    prisma.user.findUnique({ where: { orgId_email: { orgId, email } } }),
  ]);
  if (!eventRow) throw new AppError("NOT_FOUND", "Event not found");
  if (!user) throw new AppError("NOT_FOUND", "Member not found");
  const event = eventToDomain(eventRow);

  const role: Role = input.role ?? roleFromDb(user.role);
  const pointsAwarded = input.points ?? memberPointsFor({ role }, event, event.category);

  try {
    const record = await prisma.$transaction(async (tx) => {
      const registration = await tx.registration.create({
        data: {
          eventId: event.eventId,
          userId: user.id,
          pointsAwarded,
          roleAtTime: roleToDb(role),
          source: DbSource.MANUAL,
          note: input.note,
          createdAt: now,
        },
      });
      await logAdminAction(tx, orgId, {
        actor: input.addedBy,
        action: "add_attendance",
        target: `${event.eventId}:${email}`,
        detail: input.note,
      });
      return {
        id: registration.id,
        timestamp: registration.createdAt,
        eventId: event.eventId,
        email,
        role,
        pointsAwarded,
        source: "manual",
        note: input.note,
        eventPointsOverride: event.points,
        closesAt: event.closesAt,
        category: event.category,
      };
    });
    invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
    return record;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("ALREADY_REGISTERED", "This member is already logged for this event");
    }
    throw err;
  }
}

export async function deleteAttendance(orgId: string, id: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.registration.findFirst({
      where: { id, event: { orgId } },
      include: { user: { select: { email: true } } },
    });
    if (!row) throw new AppError("NOT_FOUND", "Attendance record not found");
    await tx.registration.delete({ where: { id } });
    await logAdminAction(tx, orgId, {
      actor,
      action: "delete_attendance",
      target: `${row.eventId}:${row.user.email}`,
    });
  });
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
}

/**
 * Demoting the org's last ADMIN would permanently lock everyone out of
 * /admin/settings, join codes, and every other ADMIN-only surface — there's
 * no path back in without direct DB access. Blocked regardless of how many
 * ADMIN accounts exist today (seven pre-seeded officers included — see
 * prisma/seed.ts seedHardcodedAdmins): this guards the case they ever get
 * demoted down to one.
 */
export async function setMemberRole(orgId: string, email: string, role: Role, actor: string): Promise<Member> {
  const e = email.trim().toLowerCase();
  const member = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { orgId_email: { orgId, email: e } } });
    if (!existing) throw new AppError("NOT_FOUND", "Member not found");

    if (existing.role === DbRole.ADMIN && role !== "admin") {
      const otherAdmins = await tx.user.count({ where: { orgId, role: DbRole.ADMIN, id: { not: existing.id } } });
      if (otherAdmins === 0) {
        throw new AppError("LAST_ADMIN", "Can't remove the last Admin — promote another account first.");
      }
    }

    const row = await tx.user.update({ where: { id: existing.id }, data: { role: roleToDb(role) } });
    await logAdminAction(tx, orgId, { actor, action: "change_role", target: e, detail: role });
    return userToMember(row);
  });
  // A role change moves a member on or off the GENERAL board (see
  // computeStandings' role filter) or on/off the internal E-Board track —
  // either way the cached standings are now wrong for this member.
  invalidateStandings(orgId, await getConfigValue(orgId, "SEASON", ""));
  return member;
}

/** Displayed on the internal E-Board leaderboard only — meaningless for a non-EBOARD row, but not blocked (a demoted officer keeps their title on record). */
export async function setEboardPosition(orgId: string, email: string, position: string, actor: string): Promise<Member> {
  const e = email.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    try {
      const row = await tx.user.update({
        where: { orgId_email: { orgId, email: e } },
        data: { eboardPosition: position.trim() || null },
      });
      await logAdminAction(tx, orgId, { actor, action: "set_eboard_position", target: e, detail: position });
      return userToMember(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new AppError("NOT_FOUND", "Member not found");
      }
      throw err;
    }
  });
}

export async function setMemberStatus(orgId: string, email: string, status: UserStatus, actor: string): Promise<Member> {
  const e = email.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    try {
      const row = await tx.user.update({ where: { orgId_email: { orgId, email: e } }, data: { status: statusToDb(status) } });
      await logAdminAction(tx, orgId, { actor, action: "change_status", target: e, detail: status });
      return userToMember(row);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new AppError("NOT_FOUND", "Member not found");
      }
      throw err;
    }
  });
}

export async function approveMember(orgId: string, email: string, actor: string): Promise<Member> {
  return setMemberStatus(orgId, email, "active", actor);
}

/** Rejecting suspends rather than deletes — preserves the row/audit trail. */
export async function rejectMember(orgId: string, email: string, actor: string): Promise<Member> {
  return setMemberStatus(orgId, email, "suspended", actor);
}

export interface CreateMemberAccountResult {
  member: Member;
  /** Shown to the caller exactly once — never re-derivable after this. */
  setupCode: string;
}

/**
 * E-Board/Admin provisioning for someone whose self-signup is broken. Sets a
 * bcrypt hash of a random setup code as passwordHash (mustChangePassword =
 * true) — there is no separate plaintext setup-code column; a setup-code
 * login is just a normal bcrypt compare against this hash, same as any other
 * sign-in. Status is ACTIVE immediately: an officer-created account is
 * already vouched for, unlike a self-signup awaiting approval.
 */
export async function createMemberAccount(
  orgId: string,
  email: string,
  firstName: string,
  lastName: string,
  role: Role,
  actor: string,
): Promise<CreateMemberAccountResult> {
  const e = email.trim().toLowerCase();
  const setupCode = generateSetupCode();
  const passwordHash = await hashPassword(setupCode);

  try {
    return await prisma.$transaction(async (tx) => {
      const row = await tx.user.create({
        data: {
          orgId,
          email: e,
          passwordHash,
          firstName,
          lastName,
          role: roleToDb(role),
          status: DbUserStatus.ACTIVE,
          mustChangePassword: true,
        },
      });
      await logAdminAction(tx, orgId, { actor, action: "create_member", target: e, detail: role });
      return { member: userToMember(row), setupCode };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError("ALREADY_REGISTERED", "A member with this email already exists");
    }
    throw err;
  }
}

/** Sets a real password: writes the hash, clears mustChangePassword. */
export async function setPassword(orgId: string, email: string, plain: string): Promise<void> {
  const e = email.trim().toLowerCase();
  // Hash BEFORE the write — bcrypt at cost 12 takes a couple hundred ms.
  const hash = await hashPassword(plain);

  try {
    await prisma.user.update({
      where: { orgId_email: { orgId, email: e } },
      data: { passwordHash: hash, mustChangePassword: false },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new AppError("NOT_FOUND", "Member not found");
    }
    throw err;
  }
}

/**
 * Admin-initiated "forgot password": issues a fresh setup code (hashed into
 * passwordHash), flags mustChangePassword. There is no email-based reset — no
 * mail infrastructure is assumed to exist for every deployment of this app.
 */
export async function resetPassword(orgId: string, email: string, actor: string): Promise<string> {
  const e = email.trim().toLowerCase();
  const setupCode = generateSetupCode();
  const passwordHash = await hashPassword(setupCode);

  return prisma.$transaction(async (tx) => {
    try {
      await tx.user.update({
        where: { orgId_email: { orgId, email: e } },
        data: { passwordHash, mustChangePassword: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new AppError("NOT_FOUND", "Member not found");
      }
      throw err;
    }
    await logAdminAction(tx, orgId, { actor, action: "reset_password", target: e });
    return setupCode;
  });
}

// ---------------------------------------------------------------------------
// Join codes — the sole signup security boundary. See lib/joincodes.ts for
// the orchestration layer (rate limiting, generic-failure shaping); this
// module owns the actual comparisons and the atomic useCount increment.
// ---------------------------------------------------------------------------

export interface CreateJoinCodeInput {
  orgId: string;
  label: string;
  grantsRole: Role;
  expiresAt?: Date | null;
  maxUses?: number | null;
  createdBy: string;
}

export interface CreateJoinCodeResult {
  summary: JoinCodeSummary;
  /** Shown to the caller exactly once — never re-derivable after this (only the bcrypt hash is stored). */
  plaintext: string;
}

function hintFor(plaintext: string): string {
  return `${plaintext.slice(0, 2).toUpperCase()}••••`;
}

export async function createJoinCode(input: CreateJoinCodeInput): Promise<CreateJoinCodeResult> {
  const plaintext = generateSetupCode();
  const hash = await hashPassword(plaintext);
  return prisma.$transaction(async (tx) => {
    const creator = await tx.user.findUnique({
      where: { orgId_email: { orgId: input.orgId, email: input.createdBy.trim().toLowerCase() } },
      select: { id: true },
    });
    const row = await tx.joinCode.create({
      data: {
        orgId: input.orgId,
        code: hash,
        codeHint: hintFor(plaintext),
        grantsRole: roleToDb(input.grantsRole),
        label: input.label,
        expiresAt: input.expiresAt ?? null,
        maxUses: input.maxUses ?? null,
        createdById: creator?.id ?? null,
      },
    });
    await logAdminAction(tx, input.orgId, {
      actor: input.createdBy,
      action: "create_join_code",
      target: row.id,
      detail: `${input.label} (${input.grantsRole})`,
    });
    return { summary: joinCodeToSummary(row), plaintext };
  });
}

export async function listJoinCodes(orgId: string): Promise<JoinCodeSummary[]> {
  const rows = await prisma.joinCode.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } });
  return rows.map(joinCodeToSummary);
}

export async function deactivateJoinCode(orgId: string, id: string, actor: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.joinCode.findFirst({ where: { id, orgId } });
    if (!row) throw new AppError("NOT_FOUND", "Join code not found");
    await tx.joinCode.update({ where: { id }, data: { active: false } });
    await logAdminAction(tx, orgId, { actor, action: "deactivate_join_code", target: id, detail: row.label });
  });
}

export interface UpdateJoinCodeLimitsInput {
  orgId: string;
  id: string;
  expiresAt?: Date | null;
  maxUses?: number | null;
  actor: string;
}

export async function updateJoinCodeLimits(input: UpdateJoinCodeLimitsInput): Promise<JoinCodeSummary> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.joinCode.findFirst({ where: { id: input.id, orgId: input.orgId } });
    if (!existing) throw new AppError("NOT_FOUND", "Join code not found");
    const row = await tx.joinCode.update({
      where: { id: input.id },
      data: {
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        ...(input.maxUses !== undefined ? { maxUses: input.maxUses } : {}),
      },
    });
    await logAdminAction(tx, input.orgId, { actor: input.actor, action: "update_join_code", target: input.id });
    return joinCodeToSummary(row);
  });
}

export interface RotateJoinCodeResult {
  summary: JoinCodeSummary;
  plaintext: string;
}

/** Deactivates the old code and creates a fresh one with the same label/role/limits — the old plaintext was never stored, so there's nothing to "change", only replace. */
export async function rotateJoinCodeById(orgId: string, id: string, actor: string): Promise<RotateJoinCodeResult> {
  const existing = await prisma.joinCode.findFirst({ where: { id, orgId } });
  if (!existing) throw new AppError("NOT_FOUND", "Join code not found");

  const plaintext = generateSetupCode();
  const hash = await hashPassword(plaintext);
  return prisma.$transaction(async (tx) => {
    await tx.joinCode.update({ where: { id }, data: { active: false, rotatedAt: new Date() } });
    const creator = await tx.user.findUnique({
      where: { orgId_email: { orgId, email: actor.trim().toLowerCase() } },
      select: { id: true },
    });
    const row = await tx.joinCode.create({
      data: {
        orgId,
        code: hash,
        codeHint: hintFor(plaintext),
        grantsRole: existing.grantsRole,
        label: existing.label,
        expiresAt: existing.expiresAt,
        maxUses: existing.maxUses,
        createdById: creator?.id ?? null,
      },
    });
    await logAdminAction(tx, orgId, { actor, action: "rotate_join_code", target: row.id, detail: existing.label });
    return { summary: joinCodeToSummary(row), plaintext };
  });
}

/** Internal shape used only by the matching/redemption functions below — never returned outside this module. */
interface JoinCodeCandidate {
  id: string;
  code: string;
  grantsRole: DbRole;
  label: string;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
}

async function activeJoinCodeCandidates(tx: Tx | typeof prisma, orgId: string): Promise<JoinCodeCandidate[]> {
  return tx.joinCode.findMany({
    where: { orgId, active: true },
    select: { id: true, code: true, grantsRole: true, label: true, expiresAt: true, maxUses: true, useCount: true },
  });
}

/** A code is usable right now iff active (already filtered above), not expired, and under its use cap. */
function isRedeemable(candidate: JoinCodeCandidate, now: Date): boolean {
  if (candidate.expiresAt && candidate.expiresAt.getTime() < now.getTime()) return false;
  if (candidate.maxUses !== null && candidate.useCount >= candidate.maxUses) return false;
  return true;
}

/**
 * Constant-time-per-comparison bcrypt match against every active code for
 * this org (a handful of rows) — read-only, no mutation, so this is safe to
 * call from a "does this code work?" preview without spending a use. Returns
 * null on no match, an inactive code, an expired code, or an exhausted code —
 * deliberately the same null for all four (lib/joincodes.ts turns that into
 * one generic message; this function never tells the caller which case fired).
 */
export async function matchJoinCode(
  orgId: string,
  submittedCode: string,
  now: Date = new Date(),
): Promise<{ grantsRole: Role; label: string } | null> {
  const candidates = await activeJoinCodeCandidates(prisma, orgId);
  for (const candidate of candidates) {
    if (await verifyPassword(submittedCode, candidate.code)) {
      if (!isRedeemable(candidate, now)) return null;
      return { grantsRole: roleFromDb(candidate.grantsRole), label: candidate.label };
    }
  }
  return null;
}

export interface RedeemJoinCodeForSignupInput {
  orgId: string;
  submittedCode: string;
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  profile?: ProfileFieldsInput;
  now?: Date;
}

export interface RedeemJoinCodeForSignupResult {
  member: Member;
  grantsRole: Role;
  label: string;
  /** True when an existing GUEST row (passwordHash null) was promoted in place rather than a fresh row created — the guest's prior registrations are untouched either way. */
  convertedFromGuest: boolean;
}

/**
 * The atomic half of signup (Part 3's "whole security model"): re-matches the
 * submitted code from scratch (never trusts a joinCodeId carried from an
 * earlier "preview" call — the code could have been deactivated in between),
 * atomically claims one use via a raw conditional UPDATE (ordinary
 * read-then-write inside a transaction is NOT enough here: Postgres's default
 * Read Committed isolation lets two concurrent redemptions both read
 * useCount < maxUses before either commits, which is exactly the
 * double-spend a `maxUses: 1` code exists to prevent), then creates the
 * account — or, if a GUEST row already exists for this email (someone who
 * checked into an event as a guest before ever signing up), promotes that row
 * in place instead of creating a duplicate, per Part 5's guest->member
 * conversion. Role is ALWAYS the matched code's grantsRole, never a
 * caller-supplied value — there is no role parameter on this function.
 *
 * A blank `submittedCode` is a legitimate input, not an error: general
 * membership needs no code at all, so an empty/whitespace code skips
 * matching entirely and creates a GENERAL account outright. This is also
 * what makes "claimed EBOARD/ADMIN but sent no code" downgrade to GENERAL
 * instead of failing — this function has no idea what the caller claimed,
 * it only ever looks at what code (if any) was actually submitted.
 */
export async function redeemJoinCodeForSignup(input: RedeemJoinCodeForSignupInput): Promise<RedeemJoinCodeForSignupResult> {
  const { orgId } = input;
  const email = input.email.trim().toLowerCase();
  const now = input.now ?? new Date();
  const trimmedCode = input.submittedCode.trim();
  // Signup capturing classification/major counts as confirming them for this
  // season — same stamp registerForEvent/updateProfileFields apply, so the
  // check-in form doesn't immediately re-ask (see getMissingFields).
  const profile = input.profile;
  const stampProfileSeason = profile?.classification !== undefined || profile?.major !== undefined;
  const season = stampProfileSeason ? await getConfigValue(orgId, "SEASON", "") : null;

  return prisma.$transaction(async (tx) => {
    let grantsRole: Role;
    let matchedDbRole: DbRole;
    let label: string;

    if (!trimmedCode) {
      grantsRole = "general";
      matchedDbRole = DbRole.GENERAL;
      label = "No code entered";
    } else {
      const candidates = await activeJoinCodeCandidates(tx, orgId);
      let matched: JoinCodeCandidate | null = null;
      for (const candidate of candidates) {
        if (await verifyPassword(trimmedCode, candidate.code)) {
          matched = candidate;
          break;
        }
      }
      if (!matched || !isRedeemable(matched, now)) {
        throw new AppError("VALIDATION_FAILED", "That join code doesn't work. Check it and try again.", {
          fieldErrors: { joinCode: "That join code doesn't work. Check it and try again." },
        });
      }

      // Atomic claim: re-checks active/expiry/maxUses against the CURRENT row,
      // not the snapshot read above — 0 rows back means someone else (or the
      // clock) beat us to the last use since that read.
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "JoinCode"
        SET "useCount" = "useCount" + 1
        WHERE "id" = ${matched.id}
          AND "active" = true
          AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
          AND ("maxUses" IS NULL OR "useCount" < "maxUses")
        RETURNING "id"
      `;
      if (claimed.length === 0) {
        throw new AppError("VALIDATION_FAILED", "That join code doesn't work. Check it and try again.", {
          fieldErrors: { joinCode: "That join code doesn't work. Check it and try again." },
        });
      }

      grantsRole = roleFromDb(matched.grantsRole);
      matchedDbRole = matched.grantsRole;
      label = matched.label;
    }

    const profileData = input.profile
      ? {
          ...(input.profile.studentId !== undefined ? { studentId: input.profile.studentId } : {}),
          ...(input.profile.classification !== undefined
            ? { classification: classificationToDb(input.profile.classification) }
            : {}),
          ...(input.profile.major !== undefined ? { major: input.profile.major } : {}),
          ...(input.profile.majorOther !== undefined ? { majorOther: input.profile.majorOther } : {}),
          ...(input.profile.phone !== undefined ? { phone: input.profile.phone || null } : {}),
          ...(input.profile.personalEmail !== undefined ? { personalEmail: input.profile.personalEmail || null } : {}),
          ...(input.profile.tshirtSize !== undefined ? { tshirtSize: shirtSizeToDb(input.profile.tshirtSize) } : {}),
          ...(season !== null ? { profileSeason: season } : {}),
        }
      : {};

    const existingGuest = await tx.user.findUnique({ where: { orgId_email: { orgId, email } } });
    let row: UserModel;
    let convertedFromGuest = false;
    if (existingGuest && existingGuest.passwordHash === null) {
      convertedFromGuest = true;
      row = await tx.user.update({
        where: { id: existingGuest.id },
        data: {
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          role: matchedDbRole,
          status: DbUserStatus.ACTIVE,
          ...profileData,
        },
      });
    } else {
      try {
        row = await tx.user.create({
          data: {
            orgId,
            email,
            passwordHash: input.passwordHash,
            firstName: input.firstName,
            lastName: input.lastName,
            role: matchedDbRole,
            status: DbUserStatus.ACTIVE,
            ...profileData,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new AppError("VALIDATION_FAILED", "An account with this email already exists.", {
            fieldErrors: { email: "An account with this email already exists." },
          });
        }
        throw err;
      }
    }

    await logAdminAction(tx, orgId, {
      actor: email,
      action: convertedFromGuest ? "join_code_guest_converted" : "join_code_signup",
      target: row.id,
      detail: `${label} -> ${grantsRole}`,
    });

    return { member: userToMember(row), grantsRole, label, convertedFromGuest };
  });
}

/**
 * /guest/join's redemption: matches ONLY among codes that grant GUEST — an
 * ADMIN/EBOARD/GENERAL code must fail here exactly like a wrong code, so an
 * outsider can never leverage a member code (or vice versa) to reach the
 * guest surface. Claims a use the same atomic way as signup, but creates no
 * User — a guest only gets a row once they actually check into an event (see
 * registerGuest).
 */
export async function redeemGuestJoinCode(orgId: string, submittedCode: string, now: Date = new Date()): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const candidates = await activeJoinCodeCandidates(tx, orgId);
    let matched: JoinCodeCandidate | null = null;
    for (const candidate of candidates) {
      if (candidate.grantsRole !== DbRole.GUEST) continue;
      if (await verifyPassword(submittedCode, candidate.code)) {
        matched = candidate;
        break;
      }
    }
    if (!matched || !isRedeemable(matched, now)) return null;

    const claimed = await tx.$queryRaw<Array<{ id: string }>>`
      UPDATE "JoinCode"
      SET "useCount" = "useCount" + 1
      WHERE "id" = ${matched.id}
        AND "active" = true
        AND ("expiresAt" IS NULL OR "expiresAt" > ${now})
        AND ("maxUses" IS NULL OR "useCount" < "maxUses")
      RETURNING "id"
    `;
    if (claimed.length === 0) return null;

    await logAdminAction(tx, orgId, { actor: "guest", action: "guest_pass_issued", target: matched.id, detail: matched.label });
    return matched.label;
  });
}

/** Recent ADMIN/EBOARD grants — the data source for the /admin dashboard's "a new admin appeared" banner (Part 3). No separate notification table; the AdminLog row written at redemption time IS the notification. */
export async function getRecentPrivilegedJoinCodeGrants(orgId: string, sinceDays = 14): Promise<AdminLogEntry[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);
  const rows = await prisma.adminLog.findMany({
    where: { orgId, action: "join_code_signup", createdAt: { gte: since } },
    include: { actor: { select: { email: true } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(adminLogToDomain).filter((entry) => entry.detail.includes("-> admin") || entry.detail.includes("-> eboard"));
}

// ---------------------------------------------------------------------------
// Form builder — schema-locked once any response exists for the event.
// ---------------------------------------------------------------------------

export interface FormFieldInput {
  fieldKey: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  helpText: string;
  order: number;
  prefill: string;
}

export interface SaveFormFieldsInput {
  orgId: string;
  eventId: string;
  fields: FormFieldInput[];
  actor: string;
}

/**
 * Replaces the full field list for an event's form. Once any response
 * exists, enforces the lock: a field can't be removed, its fieldKey can't
 * change, and its type can't change. New fields added after the lock must be
 * optional. This is the real boundary — the form builder UI disabling
 * controls is just a hint, not enforcement.
 */
export async function saveFormFields(input: SaveFormFieldsInput): Promise<FormField[]> {
  if (input.fields.length > MAX_EXTRA_QUESTIONS_HARD_CAP) {
    throw new AppError(
      "VALIDATION_FAILED",
      `Events can have at most ${MAX_EXTRA_QUESTIONS_HARD_CAP} extra questions — the core check-in form already covers the rest.`,
    );
  }

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findFirst({ where: { id: input.eventId, orgId: input.orgId } });
    if (!event) throw new AppError("NOT_FOUND", "Event not found");

    const existing = (await tx.formField.findMany({ where: { eventId: input.eventId } })).map(formFieldToDomain);
    const locked = (await tx.registration.findFirst({ where: { eventId: input.eventId }, select: { id: true } })) !== null;

    if (locked) {
      const existingByKey = new Map(existing.map((f) => [f.fieldKey, f]));
      const newByKey = new Map(input.fields.map((f) => [f.fieldKey, f]));
      for (const [key, oldField] of existingByKey) {
        const stillPresent = newByKey.get(key);
        if (!stillPresent) {
          throw new AppError(
            "SCHEMA_LOCKED",
            `Can't remove "${oldField.label}" — responses already exist for this event.`,
          );
        }
        if (stillPresent.type !== oldField.type) {
          throw new AppError(
            "SCHEMA_LOCKED",
            `Can't change the type of "${oldField.label}" — responses already exist for this event.`,
          );
        }
      }
      for (const [key, newField] of newByKey) {
        if (!existingByKey.has(key) && newField.required) {
          throw new AppError(
            "SCHEMA_LOCKED",
            `New field "${newField.label}" must be optional — responses already exist for this event.`,
          );
        }
      }
    }

    await tx.formField.deleteMany({ where: { eventId: input.eventId } });
    if (input.fields.length > 0) {
      await tx.formField.createMany({
        data: input.fields.map((field) => ({
          eventId: input.eventId,
          fieldKey: field.fieldKey,
          label: field.label,
          type: FIELD_TYPE_TO_DB[field.type],
          required: field.required,
          options: field.options,
          helpText: field.helpText || null,
          order: field.order,
          prefill: field.prefill || null,
        })),
      });
    }
    await logAdminAction(tx, input.orgId, { actor: input.actor, action: "update_form", target: input.eventId });

    return (await tx.formField.findMany({ where: { eventId: input.eventId }, orderBy: { order: "asc" } })).map(
      formFieldToDomain,
    );
  });
}

/** Copies another event's questions onto this one — for a brand-new event with no fields of its own yet. */
export async function copyFormFields(orgId: string, fromEventId: string, toEventId: string, actor: string): Promise<FormField[]> {
  return prisma.$transaction(async (tx) => {
    const toEvent = await tx.event.findFirst({ where: { id: toEventId, orgId } });
    if (!toEvent) throw new AppError("NOT_FOUND", "Event not found");
    const fromEvent = await tx.event.findFirst({ where: { id: fromEventId, orgId } });
    if (!fromEvent) throw new AppError("NOT_FOUND", "Source event not found");

    const sourceFields = (
      await tx.formField.findMany({ where: { eventId: fromEventId }, orderBy: { order: "asc" } })
    ).map(formFieldToDomain);

    await tx.formField.deleteMany({ where: { eventId: toEventId } });
    if (sourceFields.length > 0) {
      await tx.formField.createMany({
        data: sourceFields.map((field) => ({
          eventId: toEventId,
          fieldKey: field.fieldKey,
          label: field.label,
          type: FIELD_TYPE_TO_DB[field.type],
          required: field.required,
          options: field.options,
          helpText: field.helpText || null,
          order: field.order,
          prefill: field.prefill || null,
        })),
      });
    }
    await logAdminAction(tx, orgId, {
      actor,
      action: "copy_form",
      target: toEventId,
      detail: `Copied from ${fromEventId}`,
    });

    return (await tx.formField.findMany({ where: { eventId: toEventId }, orderBy: { order: "asc" } })).map(
      formFieldToDomain,
    );
  });
}

// ---------------------------------------------------------------------------
// Bulk member import
// ---------------------------------------------------------------------------

export interface BulkImportRow {
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export interface BulkImportSkip {
  row: BulkImportRow;
  reason: string;
}

export interface BulkImportPreview {
  toCreate: BulkImportRow[];
  toSkip: BulkImportSkip[];
}

/** Read-only dry run: what would be created vs skipped, without writing anything. */
export async function previewBulkImport(orgId: string, rows: BulkImportRow[]): Promise<BulkImportPreview> {
  const emails = rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean);
  const existingUsers = await prisma.user.findMany({ where: { orgId, email: { in: emails } }, select: { email: true } });
  const existing = new Set(existingUsers.map((u) => u.email));
  const seen = new Set<string>();
  const toCreate: BulkImportRow[] = [];
  const toSkip: BulkImportSkip[] = [];

  for (const raw of rows) {
    const email = raw.email.trim().toLowerCase();
    const row = { ...raw, email };
    if (!email || !raw.firstName.trim() || !raw.lastName.trim()) {
      toSkip.push({ row, reason: "Missing email, first name, or last name" });
      continue;
    }
    if (existing.has(email)) {
      toSkip.push({ row, reason: "Already on the roster" });
      continue;
    }
    if (seen.has(email)) {
      toSkip.push({ row, reason: "Duplicate row in this file" });
      continue;
    }
    seen.add(email);
    toCreate.push(row);
  }
  return { toCreate, toSkip };
}

export interface BulkImportCommitResult {
  created: Array<{ email: string; setupCode: string }>;
  skipped: number;
}

/**
 * Each row is its own independent create — a duplicate (P2002) just skips
 * that row rather than aborting the whole batch, and re-validates against
 * live data (not the preview) so a concurrent add between preview and commit
 * can't create a duplicate row.
 */
export async function commitBulkImport(orgId: string, rows: BulkImportRow[], actor: string): Promise<BulkImportCommitResult> {
  const seen = new Set<string>();
  const created: Array<{ email: string; setupCode: string }> = [];

  for (const raw of rows) {
    const email = raw.email.trim().toLowerCase();
    if (!email || !raw.firstName.trim() || !raw.lastName.trim()) continue;
    if (seen.has(email)) continue;
    seen.add(email);

    const setupCode = generateSetupCode();
    const passwordHash = await hashPassword(setupCode);
    try {
      await prisma.user.create({
        data: {
          orgId,
          email,
          passwordHash,
          firstName: raw.firstName.trim(),
          lastName: raw.lastName.trim(),
          role: roleToDb(raw.role),
          status: DbUserStatus.ACTIVE,
          mustChangePassword: true,
        },
      });
      created.push({ email, setupCode });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }

  await prisma.$transaction(async (tx) => {
    await logAdminAction(tx, orgId, {
      actor,
      action: "bulk_import_members",
      target: "members",
      detail: `${created.length} created, ${rows.length - created.length} skipped`,
    });
  });

  return { created, skipped: rows.length - created.length };
}

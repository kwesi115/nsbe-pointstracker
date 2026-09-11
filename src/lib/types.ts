/**
 * Pure domain types. These are the shapes lib/repo.ts returns — never raw
 * Prisma rows — and the only shapes lib/points.ts, lib/code.ts, and
 * lib/forms.ts know about. Prisma's generated enums/models are mapped to
 * these at the repo.ts boundary; nothing outside repo.ts should import from
 * src/generated/prisma directly.
 */

export type Role = "admin" | "eboard" | "general" | "guest";

/** A narrow, revocable capability grantable to one member independent of role — see lib/permissions.ts and prisma/schema.prisma's PermissionGrant. */
export type PermissionName = "verifications_write";

export type ShirtSize = "XS" | "S" | "M" | "L" | "XL" | "XXL" | "XXXL";

/** EBOARD_ONLY events never appear in the member feed or member leaderboard — see lib/points.ts eboardAwardFor. */
export type Audience = "all" | "eboard_only";

export type Classification = "freshman" | "sophomore" | "junior" | "senior" | "graduate";

export type FileKind = "resume" | "house_proof";

export type GroupKind = "nsbe_week";

export type AwardKind = "game_competition" | "monthly_champion" | "manual";

// No "live"/"closed" — whether an event is open is derived from the clock (see lib/points.ts isOpen).
export type EventStatus = "draft" | "scheduled" | "canceled";

export type FieldType =
  | "short_text"
  | "long_text"
  | "select"
  | "multi_select"
  | "number"
  | "yes_no"
  | "rating"
  | "date";

/** Signup/approval lifecycle — orthogonal to Role. See lib/signup.ts. */
export type UserStatus = "pending" | "active" | "suspended";

export interface Member {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  studentId: string;
  classification: Classification | "";
  major: string;
  majorOther: string;
  membership: string;
  phone: string;
  personalEmail: string;
  tshirtSize: ShirtSize | "";
  role: Role;
  status: UserStatus;
  joinedAt: Date | null;

  /** Displayed on the internal E-Board leaderboard only. Meaningful only when role === "eboard". */
  eboardPosition: string;

  // Four distinct states, never three — see lib/claim-state.ts claimState,
  // which is the only thing allowed to interpret this group of fields.
  // duesPaidReported is what the MEMBER said; duesVerifiedAt is what an
  // ADMIN checked. They are not interchangeable and must never render the
  // same glyph.
  duesPaidReported: boolean | null;
  duesReportedAt: Date | null;
  duesVerifiedAt: Date | null;
  duesVerifiedById: string;
  duesRevokedAt: Date | null;
  duesRevokedById: string;
  duesRevokedNote: string;

  nationalMemberReported: boolean | null;
  nsbeMembershipId: string;
  nationalVerifiedAt: Date | null;
  nationalVerifiedById: string;
  nationalRevokedAt: Date | null;
  nationalRevokedById: string;
  nationalRevokedNote: string;

  /** The season (Config.SEASON) dues/national were last confirmed for — see lib/points.ts isEligible. */
  membershipSeason: string;

  /** The season (Config.SEASON) classification/major were last confirmed for — see lib/core-form.ts getMissingFields. */
  profileSeason: string;

  house: string;
  houseVerifiedAt: Date | null;
  /** A User id, or the literal HOUSE_SYSTEM_VERIFIER for an E-Board House verified on selection. */
  houseVerifiedById: string;
  houseProofFileId: string | null;

  resumeFileId: string | null;
  resumeUpdatedAt: Date | null;
  resumeConsentAt: Date | null;
}

export interface UploadedFile {
  id: string;
  userId: string;
  kind: FileKind;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date | null;
}

/**
 * The credential-bearing half of a User row. Only repo.getAuthRecord()
 * returns this — never mix it into Member/getMembers()/getMember(), and
 * never let it reach a response body, a session, or the admin export.
 * passwordHash is always set: self-service signup hashes the chosen password
 * immediately, and admin-provisioned accounts get a bcrypt hash of a random
 * setup code instead of a separate plaintext setup-code column — see
 * repo.createMemberAccount.
 */
export interface AuthRecord {
  email: string;
  /** Null for a GUEST row created by registerGuest() — see lib/auth.ts authorize(), which rejects that regardless of what's submitted. */
  passwordHash: string | null;
  role: Role;
  mustChangePassword: boolean;
  status: UserStatus;
}

export interface Org {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  logoUrl: string;
  primaryColor: string;
  active: boolean;
}

export interface JoinCodeSummary {
  id: string;
  label: string;
  grantsRole: Role;
  codeHint: string;
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  useCount: number;
  createdAt: Date | null;
  rotatedAt: Date | null;
}

/** Replaces the old flat PointSystem map — see lib/points.ts memberPointsFor/eboardAwardFor. */
export interface EventCategory {
  id: string;
  code: string;
  name: string;
  shortName: string;
  /** null for non-tiered categories (NSBE Week, E-Board meeting/retreat). */
  tier: number | null;
  memberPoints: number;
  examples: string;
  countsForMonthly: boolean;
  eboardEligible: boolean;
  audience: Audience;
  active: boolean;
  sortOrder: number;
}

export interface BonusTier {
  min: number;
  max: number | null;
  bonus: number;
}

/** An NSBE-Week-shaped set of events — see lib/points.ts groupBonusFor. */
export interface EventGroup {
  id: string;
  name: string;
  slug: string;
  kind: GroupKind;
  expectedEventCount: number;
  bonusTiers: BonusTier[];
  eventIds: string[];
  finalizedAt: Date | null;
  finalizedById: string;
  createdAt: Date | null;
}

export interface PointAward {
  id: string;
  email: string;
  kind: AwardKind;
  points: number;
  eventId: string | null;
  /** "2026-09" — set only for MONTHLY_CHAMPION. */
  periodMonth: string | null;
  reason: string;
  awardedById: string;
  awardedAt: Date | null;
  revokedAt: Date | null;
  revokedById: string;
  revokeNote: string;
}

export interface Event {
  eventId: string;
  /** Human-readable, unique — used for export sheet/file names. Never used for routing. */
  slug: string;
  name: string;
  categoryId: string;
  /** Embedded snapshot of the live category row — see lib/repo.ts eventToDomain. Always the CURRENT category values, never frozen at creation time. */
  category: EventCategory;
  /** The NSBE-Week-style set this event belongs to, if any. */
  groupId: string | null;
  date: Date | null;
  location: string;
  description: string;
  /** Explicit override for this event's point value. null = fall back to category.memberPoints. A 0 override is distinct from null. */
  points: number | null;
  status: EventStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  durationMinutes: number | null;
  openedBy: string;
  openedAt: Date | null;
  createdBy: string;
  createdAt: Date | null;
  audience: Audience;
}

export interface FormField {
  eventId: string;
  fieldKey: string;
  label: string;
  type: FieldType;
  required: boolean;
  options: string[];
  helpText: string;
  order: number;
  prefill: string;
}

export interface AttendanceRecord {
  id: string;
  timestamp: Date | null;
  eventId: string;
  email: string;
  /** The role frozen at submit time — NOT authoritative for standings, see computeStandings. */
  role: Role;
  /** Historical snapshot of what memberPointsFor produced at check-in time — audit/display only. NOT read by computeStandings, which re-derives from the live category/override so a later point-value edit changes derived totals with no backfill. */
  pointsAwarded: number;
  source: string;
  note: string;
  /** The event's live pointsOverride — see lib/points.ts memberPointsFor. */
  eventPointsOverride: number | null;
  /** The event's live closesAt — needed to bucket a registration into a calendar month for the Monthly Engagement Champion. */
  closesAt: Date | null;
  category: Pick<EventCategory, "memberPoints" | "eboardEligible" | "countsForMonthly">;
}

/** eventPoints/nsbeWeekBonus/gameBonus/monthlyChampionBonus/manualBonus sum to total — see lib/points.ts memberTotal. */
export interface PointBreakdown {
  eventPoints: number;
  nsbeWeekBonus: number;
  gameBonus: number;
  monthlyChampionBonus: number;
  manualBonus: number;
  total: number;
}

export interface Standing {
  email: string;
  firstName: string;
  lastName: string;
  points: number;
  events: number;
  rank: number;
}

export interface MemberSummary {
  email: string;
  points: number;
  events: number;
  rank: number | null;
  totalRanked: number;
}

export interface AdminLogEntry {
  timestamp: Date | null;
  actor: string;
  action: string;
  target: string;
  detail: string;
}

/** Derived account state for the members table — never stored as a column. */
export type AccountState = "active" | "setup_pending" | "reset_pending";

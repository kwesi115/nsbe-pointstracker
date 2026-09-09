/**
 * Pure point/ranking/open-window logic. No filesystem or network access.
 * Point totals and ranks are always DERIVED here from the Attendance log —
 * never stored as a running total. This includes the member-track event
 * points themselves: Registration.pointsAwarded is a historical snapshot for
 * display/audit only (see AttendanceRecord.pointsAwarded) — computeStandings
 * re-derives from the LIVE category/event-override every time, so editing a
 * category's point value changes every past registration's contribution to
 * the leaderboard with no backfill.
 */

import type {
  AttendanceRecord,
  BonusTier,
  Event,
  EventCategory,
  Member,
  MemberSummary,
  PointAward,
  PointBreakdown,
  Role,
  Standing,
} from "./types";
import { normalizeEmail } from "./email";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The one place "eboard or admin" is spelled out — UI-only shortcut for what
 * to render (e.g. the /admin nav link, whether an EBOARD_ONLY event is
 * visible). Never a substitute for requireAdmin()/requireEboard()
 * (lib/session.ts) at an actual enforcement point — those re-read the role
 * from the roster instead of trusting a session's possibly-stale role.
 */
export function isEboardOrAdmin(role: Role): boolean {
  return role === "eboard" || role === "admin";
}

/**
 * Whether an event is open for registration RIGHT NOW. Pure function of the
 * clock — never a stored boolean, never driven by a cron job.
 */
export function isOpen(event: Pick<Event, "status" | "opensAt" | "closesAt">, now: Date): boolean {
  if (event.status !== "scheduled") return false;
  if (!event.opensAt || !event.closesAt) return false;
  const t = now.getTime();
  return t >= event.opensAt.getTime() && t <= event.closesAt.getTime();
}

/** Milliseconds remaining until the event closes; 0 if not currently open. */
export function msRemaining(event: Pick<Event, "status" | "opensAt" | "closesAt">, now: Date): number {
  if (!isOpen(event, now)) return 0;
  return Math.max(0, event.closesAt!.getTime() - now.getTime());
}

/** True if a scheduled event's window closed within the last `windowMs` (default 24h). */
export function closedRecently(
  event: Pick<Event, "status" | "closesAt">,
  now: Date,
  windowMs: number = DAY_MS,
): boolean {
  if (event.status !== "scheduled") return false;
  if (!event.closesAt) return false;
  const diff = now.getTime() - event.closesAt.getTime();
  return diff > 0 && diff <= windowMs;
}

/**
 * The member-track point value for one registration: 0 unless the CURRENT
 * roster role is general, otherwise the event's explicit override (0 is
 * honored — it is not the same as no override) or else the category's
 * current point value. No tier/point value is ever hardcoded here — both
 * inputs are live data, which is what makes an admin's category edit change
 * derived totals immediately.
 */
export function memberPointsFor(
  user: Pick<Member, "role">,
  event: Pick<Event, "points">,
  category: Pick<EventCategory, "memberPoints">,
): number {
  if (user.role !== "general") return 0;
  return event.points ?? category.memberPoints;
}

export interface EboardScoringConfig {
  EBOARD_POINT_VALUE: string;
  /** Kill switch for the whole internal track. */
  EBOARD_TRACK_ENABLED: boolean;
}

/**
 * The E-Board track's scoring rule: flat EBOARD_POINT_VALUE per qualifying
 * activity, completely independent of member pointsAwarded (which stays 0
 * for anyone not role "general" — see memberPointsFor). Never stored —
 * evaluated fresh at read time from the current role and the event's CURRENT
 * category.eboardEligible flag (replaces the old per-event countsForEboard
 * column — moving it into the category keeps it editable with no deploy,
 * same as every other point-shaped setting in this file). No tiers, no NSBE
 * Week bonus, no game bonus, no monthly champion ever touch this track.
 */
export function eboardAwardFor(
  role: Role,
  category: Pick<EventCategory, "eboardEligible">,
  config: EboardScoringConfig,
): number {
  if (!config.EBOARD_TRACK_ENABLED) return 0;
  if (role !== "eboard") return 0;
  if (!category.eboardEligible) return 0;
  return Number(config.EBOARD_POINT_VALUE) || 0;
}

/**
 * Whether a member's points count toward standings. Purely self-reported —
 * admin verification (duesVerifiedAt/nationalVerifiedAt) is an audit layer
 * only and never gates this. Registration.pointsAwarded is always the full
 * amount, unconditionally — this is evaluated fresh at read time, exactly
 * like role in computeStandings, which is what makes reporting dues/national
 * later retroactively unlock every past point with no backfill.
 *
 * currentSeason (Config.SEASON) must match the member's stamped
 * membershipSeason — this is the entire season-rollover mechanism. Bumping
 * Config.SEASON makes every member's stored membershipSeason stop matching
 * at once, with no script and no bulk update. The Boolean(currentSeason)
 * guard stops an unset Config.SEASON ("") from accidentally matching an
 * unset membershipSeason ("") on a member who has never reported anything.
 */
export function isEligible(
  member: Pick<Member, "duesPaidReported" | "nationalMemberReported" | "membershipSeason">,
  currentSeason: string,
): boolean {
  return (
    Boolean(currentSeason) &&
    member.duesPaidReported === true &&
    member.nationalMemberReported === true &&
    member.membershipSeason === currentSeason
  );
}

// ---------------------------------------------------------------------------
// NSBE Week — event groups with a completion bonus (Part 2). Derived, never
// stored: the bonus is 0 before completion and applies retroactively once
// the group completes, because it's recomputed from scratch on every read.
// ---------------------------------------------------------------------------

export interface GroupBonusInput {
  events: Pick<Event, "eventId" | "status" | "closesAt">[];
  bonusTiers: BonusTier[];
  finalizedAt: Date | null;
}

/**
 * A group is complete once an admin finalizes it (the manual override for a
 * canceled planned event — the group then settles against whatever events
 * actually exist), OR once every event in it has actually happened (not
 * DRAFT) and closed. `now` is explicit, like isOpen's — never read from the
 * clock internally, so this stays a pure function of its inputs.
 */
export function isGroupComplete(group: Pick<GroupBonusInput, "events" | "finalizedAt">, now: Date): boolean {
  if (group.finalizedAt !== null) return true;
  if (group.events.length === 0) return false;
  return group.events.every(
    (e) => e.status !== "draft" && e.closesAt !== null && e.closesAt.getTime() <= now.getTime(),
  );
}

/**
 * The NSBE Week completion bonus for ONE member, given only THEIR OWN
 * registrations. 0 unless the group is complete. Otherwise counts how many
 * of the group's events this member attended and returns the bonus of the
 * highest-matching tier — "1-2 of 5 -> no bonus" is simply the absence of a
 * matching tier, not a special case; if a tier's max is null it has no
 * ceiling (e.g. "5 or more").
 */
export function groupBonusFor(
  memberRegistrations: Pick<AttendanceRecord, "eventId">[],
  group: GroupBonusInput,
  now: Date,
): number {
  if (!isGroupComplete(group, now)) return 0;
  const eventIds = new Set(group.events.map((e) => e.eventId));
  const count = memberRegistrations.filter((r) => eventIds.has(r.eventId)).length;
  const applicable = group.bonusTiers.filter((t) => count >= t.min && (t.max === null || count <= t.max));
  if (applicable.length === 0) return 0;
  return Math.max(...applicable.map((t) => t.bonus));
}

// ---------------------------------------------------------------------------
// Monthly Engagement Champion (Part 3) — derived for closed months; the
// caller (lib/repo.ts) is responsible for MATERIALIZING the result into a
// PointAward when a month closes, so the award survives a later category
// edit and E-Board can see who won before it counts.
// ---------------------------------------------------------------------------

function monthKeyOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-09" is over once `now` reaches October 1 — the month must have fully closed before anyone can be crowned champion for it. */
export function isMonthOver(month: string, now: Date): boolean {
  const [year, mon] = month.split("-").map(Number);
  const nextMonthStart = new Date(year, mon, 1);
  return now.getTime() >= nextMonthStart.getTime();
}

export interface MonthlyChampionConfig {
  /** Config.MONTHLY_CHAMPION_MIN_EVENTS — a member below this floor never takes +5, even if they're the max. */
  minEvents: number;
}

export interface MonthlyChampionResult {
  email: string;
  count: number;
}

/**
 * Every GENERAL member tied for the most countsForMonthly attendance within
 * a closed calendar month — ties ALL receive the bonus, there is no
 * tiebreaker. Returns [] before the month is over (no provisional champion)
 * and [] if even the max count is below MONTHLY_CHAMPION_MIN_EVENTS.
 */
export function monthlyChampions(
  registrations: Pick<AttendanceRecord, "email" | "role" | "closesAt" | "category">[],
  month: string,
  config: MonthlyChampionConfig,
  now: Date,
): MonthlyChampionResult[] {
  if (!isMonthOver(month, now)) return [];

  const counts = new Map<string, number>();
  for (const r of registrations) {
    if (r.role !== "general") continue;
    if (!r.category.countsForMonthly) continue;
    if (!r.closesAt || monthKeyOf(r.closesAt) !== month) continue;
    counts.set(r.email, (counts.get(r.email) ?? 0) + 1);
  }
  if (counts.size === 0) return [];

  const max = Math.max(...counts.values());
  if (max < config.minEvents) return [];
  return Array.from(counts.entries())
    .filter(([, count]) => count === max)
    .map(([email, count]) => ({ email, count }));
}

// ---------------------------------------------------------------------------
// Member scoring — Part 4. memberTotal sums the full breakdown; computeStandings
// still filters to role GENERAL + isEligible and ranks the same way it always has.
// ---------------------------------------------------------------------------

/**
 * One member's full point breakdown for the season: live-derived event
 * points (see memberPointsFor) plus every bonus that applies to them right
 * now. `now` drives both the NSBE Week completion check and nothing else —
 * awards are pre-filtered to active (non-revoked) by the caller... actually
 * filtered here, see below.
 */
export function memberTotal(
  user: Pick<Member, "role">,
  registrations: Pick<AttendanceRecord, "eventId" | "eventPointsOverride" | "category">[],
  awards: Pick<PointAward, "kind" | "points" | "revokedAt">[],
  groups: GroupBonusInput[],
  now: Date,
): PointBreakdown {
  const eventPoints = registrations.reduce(
    (sum, r) => sum + memberPointsFor(user, { points: r.eventPointsOverride }, r.category),
    0,
  );

  const memberEventIds = registrations.map((r) => ({ eventId: r.eventId }));
  const nsbeWeekBonus = groups.reduce((sum, g) => sum + groupBonusFor(memberEventIds, g, now), 0);

  const active = awards.filter((a) => a.revokedAt === null);
  const sumKind = (kind: PointAward["kind"]) => active.filter((a) => a.kind === kind).reduce((sum, a) => sum + a.points, 0);
  const gameBonus = sumKind("game_competition");
  const monthlyChampionBonus = sumKind("monthly_champion");
  const manualBonus = sumKind("manual");

  return {
    eventPoints,
    nsbeWeekBonus,
    gameBonus,
    monthlyChampionBonus,
    manualBonus,
    total: eventPoints + nsbeWeekBonus + gameBonus + monthlyChampionBonus + manualBonus,
  };
}

/**
 * Standard competition ranking (14, 14, 12 -> 1, 1, 3): sorts by points desc,
 * events desc, lastName asc as tiebreakers (ties share a rank by points
 * only), then assigns ranks. Generic so it can carry extra per-row data
 * (e.g. a breakdown) through ranking without a second implementation — the
 * one ranking implementation shared by both the member board and the
 * internal E-Board board.
 */
interface RankableRow {
  email: string;
  firstName: string;
  lastName: string;
  points: number;
  events: number;
}

function rankRows<T extends RankableRow>(rows: T[]): Array<T & { rank: number }> {
  const sorted = [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.events !== a.events) return b.events - a.events;
    return a.lastName.localeCompare(b.lastName);
  });

  const standings: Array<T & { rank: number }> = [];
  let rank = 0;
  let seen = 0;
  let prevPoints: number | null = null;
  for (const row of sorted) {
    seen += 1;
    if (prevPoints === null || row.points !== prevPoints) {
      rank = seen;
      prevPoints = row.points;
    }
    standings.push({ ...row, rank });
  }
  return standings;
}

function memberRows(
  attendance: AttendanceRecord[],
  members: Member[],
  currentSeason: string,
  awards: Pick<PointAward, "email" | "kind" | "points" | "revokedAt">[],
  groups: GroupBonusInput[],
  now: Date,
): Array<RankableRow & { breakdown: PointBreakdown }> {
  const generalMembers = members.filter((m) => m.role === "general" && isEligible(m, currentSeason));
  return generalMembers.map((m) => {
    const memberAttendance = attendance.filter((a) => a.email === m.email);
    const memberAwards = awards.filter((a) => a.email === m.email);
    const breakdown = memberTotal(m, memberAttendance, memberAwards, groups, now);
    return {
      email: m.email,
      firstName: m.firstName,
      lastName: m.lastName,
      points: breakdown.total,
      events: memberAttendance.length,
      breakdown,
    };
  });
}

/**
 * Standings, derived fresh from the Attendance log every time. Filters to
 * members whose CURRENT roster role is "general" — not the role frozen on
 * each attendance row — so a role change re-filters someone off the board
 * immediately, without rewriting history. Also filters to
 * isEligible(member, currentSeason) — an ineligible member never appears on
 * the leaderboard at all, though every bonus below still accrues for them
 * (see lib/repo.ts getStandings) with no backfill once they report.
 */
export function computeStandings(
  attendance: AttendanceRecord[],
  members: Member[],
  currentSeason: string,
  awards: Pick<PointAward, "email" | "kind" | "points" | "revokedAt">[],
  groups: GroupBonusInput[],
  now: Date,
): Standing[] {
  return rankRows(memberRows(attendance, members, currentSeason, awards, groups, now)).map(
    ({ breakdown: _breakdown, ...standing }) => standing,
  );
}

/** Same computation as computeStandings, but keeps each row's full breakdown for the leaderboard's row-expand and the dashboard. */
export function computeStandingsWithBreakdowns(
  attendance: AttendanceRecord[],
  members: Member[],
  currentSeason: string,
  awards: Pick<PointAward, "email" | "kind" | "points" | "revokedAt">[],
  groups: GroupBonusInput[],
  now: Date,
): Array<Standing & { breakdown: PointBreakdown }> {
  return rankRows(memberRows(attendance, members, currentSeason, awards, groups, now));
}

/**
 * The tag format shared by lib/standings-cache.ts (what getCachedStandings
 * tags its entry with) and lib/repo.ts (what every mutation that changes a
 * member's standing invalidates). Defined here — pure, no repo.ts or
 * standings-cache.ts dependency — so the two files never import each other
 * just to agree on a string.
 */
export function standingsCacheTag(orgId: string, season: string): string {
  return `standings:${orgId}:${season}`;
}

/**
 * Rank of one live-computed row against an otherwise-cached standings
 * snapshot: replaces (or inserts) `self` into `cached` by email, then reruns
 * the same tie-break rules computeStandings itself uses (points desc, events
 * desc, lastName asc). Lets the dashboard show a member their own
 * just-earned points instantly (computed fresh, never from the cache) while
 * still ranking them against everyone else's cached — up to 30s stale —
 * standing, instead of forcing a full board recompute on every dashboard
 * load.
 */
export function rankWithLiveSelf(
  cached: Standing[],
  self: Pick<Standing, "email" | "firstName" | "lastName" | "points" | "events">,
): number {
  const e = self.email.toLowerCase();
  const others = cached.filter((s) => s.email.toLowerCase() !== e);
  const ranked = rankRows([...others, self]);
  return ranked.find((s) => s.email.toLowerCase() === e)!.rank;
}

export interface EboardStandingsConfig extends EboardScoringConfig {
  /** Config.EBOARD_REQUIRES_MEMBERSHIP — default false: officers doing chapter work aren't gated on a dues receipt. */
  requireMembership: boolean;
  currentSeason: string;
}

/**
 * Internal E-Board standings, derived fresh every time exactly like
 * computeStandings — filters to CURRENT role "eboard" (a promotion
 * retroactively pulls in that member's whole history of eboardEligible
 * activities with no backfill; a demotion drops them immediately). "events"
 * counts every registration belonging to a current-eboard user, matching
 * computeStandings' own "even a 0-point event still counts as attended"
 * behavior; "points" sums eboardAwardFor per row, reading each row's
 * embedded category — explicitly UNCHANGED by, and untouched by, Part 1-3's
 * tiers/NSBE-Week bonus/game bonus/monthly champion.
 */
export function computeEboardStandings(
  attendance: AttendanceRecord[],
  users: Member[],
  config: EboardStandingsConfig,
): Standing[] {
  const eboardUsers = users.filter(
    (u) => u.role === "eboard" && (!config.requireMembership || isEligible(u, config.currentSeason)),
  );
  const rows = eboardUsers.map((u) => {
    const userAttendance = attendance.filter((a) => a.email === u.email);
    const points = userAttendance.reduce((sum, a) => sum + eboardAwardFor("eboard", a.category, config), 0);
    return { email: u.email, firstName: u.firstName, lastName: u.lastName, points, events: userAttendance.length };
  });

  return rankRows(rows);
}

export function summaryFor(email: string, standings: Standing[]): MemberSummary {
  const e = normalizeEmail(email);
  const row = standings.find((s) => s.email.toLowerCase() === e);
  return {
    email: e,
    points: row?.points ?? 0,
    events: row?.events ?? 0,
    rank: row?.rank ?? null,
    totalRanked: standings.length,
  };
}

export function hasRegistered(attendance: AttendanceRecord[], eventId: string, email: string): boolean {
  const e = normalizeEmail(email);
  return attendance.some((r) => r.eventId === eventId && r.email.toLowerCase() === e);
}

export interface AttendanceRateResult {
  attended: number;
  eligible: number;
}

/**
 * Eligible denominator = events that actually happened (openedAt !== null)
 * and didn't close before the member's account existed — "do not penalize
 * someone for events before they joined" (/admin/members/[id] Insights
 * panel). attended = how many of those this member has a Registration for.
 */
export function attendanceRate(
  history: AttendanceRecord[],
  events: Pick<Event, "eventId" | "openedAt" | "closesAt">[],
  joinedAt: Date | null,
): AttendanceRateResult {
  const eligibleEvents = events.filter(
    (e) => e.openedAt !== null && (e.closesAt === null || joinedAt === null || e.closesAt >= joinedAt),
  );
  const eligibleIds = new Set(eligibleEvents.map((e) => e.eventId));
  const attended = history.filter((r) => eligibleIds.has(r.eventId)).length;
  return { attended, eligible: eligibleEvents.length };
}

/** Longest run of consecutive "attended" flags over the member's own eligible events, in chronological order — a miss resets the streak. */
export function longestAttendanceStreak(
  eligibleEventsChronological: Pick<Event, "eventId">[],
  attendedEventIds: Set<string>,
): number {
  let longest = 0;
  let current = 0;
  for (const event of eligibleEventsChronological) {
    if (attendedEventIds.has(event.eventId)) {
      current += 1;
      longest = Math.max(longest, current);
    } else {
      current = 0;
    }
  }
  return longest;
}

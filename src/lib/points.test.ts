import { describe, expect, it } from "vitest";
import {
  attendanceRate,
  closedRecently,
  computeEboardStandings,
  computeStandings,
  eboardAwardFor,
  groupBonusFor,
  hasRegistered,
  isEligible,
  isGroupComplete,
  isMonthOver,
  isOpen,
  longestAttendanceStreak,
  memberPointsFor,
  memberTotal,
  monthlyChampions,
  msRemaining,
  rankWithLiveSelf,
  standingsCacheTag,
  summaryFor,
  type EboardStandingsConfig,
  type GroupBonusInput,
} from "./points";
import type { AttendanceRecord, BonusTier, Event, EventCategory, Member, PointAward } from "./types";

const NOW = new Date("2026-01-01T00:00:00-05:00");
const SEASON = "2026-2027";

function makeCategory(overrides: Partial<EventCategory> = {}): EventCategory {
  return {
    id: "cat-gbm",
    code: "GBM",
    name: "General Body Meeting",
    shortName: "GBM",
    tier: 1,
    memberPoints: 3,
    examples: "",
    countsForMonthly: true,
    eboardEligible: true,
    audience: "all",
    active: true,
    sortOrder: 0,
    ...overrides,
  };
}

const TIER2 = makeCategory({ id: "cat-tier2", code: "AEX_CI", name: "Retention/APEX", shortName: "AEX/CI", tier: 2, memberPoints: 2 });
const FUNCTIONAL = makeCategory({ id: "cat-functional", code: "FUNCTIONAL", name: "Functional", shortName: "Functional", tier: 3, memberPoints: 1 });
const EBOARD_MEETING = makeCategory({
  id: "cat-eboard-meeting",
  code: "EBOARD_MEETING",
  name: "E-Board Meeting",
  shortName: "E-Board Mtg",
  tier: null,
  memberPoints: 0,
  countsForMonthly: false,
  eboardEligible: true,
  audience: "eboard_only",
});

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    eventId: "ev1",
    slug: "test-event",
    name: "Test Event",
    categoryId: "cat-gbm",
    category: makeCategory(),
    groupId: null,
    date: null,
    location: "",
    description: "",
    points: null,
    status: "scheduled",
    opensAt: new Date("2026-01-01T18:00:00-05:00"),
    closesAt: new Date("2026-01-01T19:00:00-05:00"),
    durationMinutes: 60,
    openedBy: "",
    openedAt: null,
    createdBy: "",
    createdAt: null,
    audience: "all",
    ...overrides,
  };
}

// Defaults to fully eligible (both self-reported, matching SEASON) so
// existing rank/role tests (unrelated to eligibility) don't need to know
// about it.
function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: "u1",
    email: "a@bison.howard.edu",
    firstName: "A",
    lastName: "Aaronson",
    studentId: "",
    classification: "",
    major: "",
    majorOther: "",
    membership: "",
    phone: "",
    personalEmail: "",
    tshirtSize: "",
    role: "general",
    status: "active",
    joinedAt: null,
    eboardPosition: "",
    duesPaidReported: true,
    duesReportedAt: NOW,
    duesVerifiedAt: NOW,
    duesVerifiedById: "",
    duesRevokedAt: null,
    duesRevokedById: "",
    duesRevokedNote: "",
    nationalMemberReported: true,
    nsbeMembershipId: "",
    nationalVerifiedAt: NOW,
    nationalVerifiedById: "",
    nationalRevokedAt: null,
    nationalRevokedById: "",
    nationalRevokedNote: "",
    membershipSeason: SEASON,
    profileSeason: SEASON,
    house: "",
    houseVerifiedAt: null,
    houseVerifiedById: "",
    houseProofFileId: null,
    resumeFileId: null,
    resumeUpdatedAt: null,
    resumeConsentAt: null,
    ...overrides,
  };
}

function makeAttendance(overrides: Partial<AttendanceRecord> = {}): AttendanceRecord {
  return {
    id: "a1",
    timestamp: new Date("2026-01-01T18:30:00-05:00"),
    eventId: "ev1",
    email: "a@bison.howard.edu",
    role: "general",
    pointsAwarded: 3,
    source: "member",
    note: "",
    eventPointsOverride: null,
    closesAt: new Date("2026-01-01T19:00:00-05:00"),
    category: makeCategory(),
    ...overrides,
  };
}

function makeAward(overrides: Partial<PointAward> = {}): PointAward {
  return {
    id: "award1",
    email: "a@bison.howard.edu",
    kind: "game_competition",
    points: 1,
    eventId: "ev1",
    periodMonth: null,
    reason: "",
    awardedById: "",
    awardedAt: NOW,
    revokedAt: null,
    revokedById: "",
    revokeNote: "",
    ...overrides,
  };
}

describe("memberPointsFor", () => {
  it("GBM (Tier 1) awards 3, a Tier 2 category awards 2, Functional (Tier 3) awards 1", () => {
    const event = makeEvent();
    expect(memberPointsFor({ role: "general" }, event, makeCategory())).toBe(3);
    expect(memberPointsFor({ role: "general" }, event, TIER2)).toBe(2);
    expect(memberPointsFor({ role: "general" }, event, FUNCTIONAL)).toBe(1);
  });

  it("only role general earns points", () => {
    const event = makeEvent();
    expect(memberPointsFor({ role: "eboard" }, event, makeCategory())).toBe(0);
    expect(memberPointsFor({ role: "guest" }, event, makeCategory())).toBe(0);
  });

  it("an explicit event override wins over the category's point value", () => {
    expect(memberPointsFor({ role: "general" }, { points: 10 }, makeCategory())).toBe(10);
  });

  it("a 0 override is honored — it is distinct from no override (null)", () => {
    expect(memberPointsFor({ role: "general" }, { points: 0 }, makeCategory())).toBe(0);
    expect(memberPointsFor({ role: "general" }, { points: null }, makeCategory())).toBe(3);
  });
});

describe("NSBE Week — groupBonusFor / isGroupComplete", () => {
  const BONUS_TIERS: BonusTier[] = [
    { min: 3, max: 4, bonus: 3 },
    { min: 5, max: null, bonus: 5 },
  ];
  const GROUP_EVENTS = ["w1", "w2", "w3", "w4", "w5"].map((id) =>
    makeEvent({ eventId: id, status: "scheduled", closesAt: new Date("2026-01-05T20:00:00-05:00") }),
  );
  const COMPLETE_GROUP: GroupBonusInput = { events: GROUP_EVENTS, bonusTiers: BONUS_TIERS, finalizedAt: null };
  const AFTER = new Date("2026-01-06T00:00:00-05:00");
  const BEFORE = new Date("2026-01-03T00:00:00-05:00");

  function attended(n: number): Pick<AttendanceRecord, "eventId">[] {
    return GROUP_EVENTS.slice(0, n).map((e) => ({ eventId: e.eventId }));
  }

  it("2 of 5 -> no bonus; 3 of 5 -> +3; 4 of 5 -> +3; 5 of 5 -> +5", () => {
    expect(groupBonusFor(attended(2), COMPLETE_GROUP, AFTER)).toBe(0);
    expect(groupBonusFor(attended(3), COMPLETE_GROUP, AFTER)).toBe(3);
    expect(groupBonusFor(attended(4), COMPLETE_GROUP, AFTER)).toBe(3);
    expect(groupBonusFor(attended(5), COMPLETE_GROUP, AFTER)).toBe(5);
  });

  it("the bonus is 0 until the group is complete, then applies retroactively — no stored value, just recomputed", () => {
    expect(groupBonusFor(attended(5), COMPLETE_GROUP, BEFORE)).toBe(0);
    expect(isGroupComplete(COMPLETE_GROUP, BEFORE)).toBe(false);
    expect(groupBonusFor(attended(5), COMPLETE_GROUP, AFTER)).toBe(5);
    expect(isGroupComplete(COMPLETE_GROUP, AFTER)).toBe(true);
  });

  it("finalizing a group with only 4 events (a 5th was canceled/never created) settles the bonus against the events that exist", () => {
    const fourEventGroup: GroupBonusInput = {
      events: GROUP_EVENTS.slice(0, 4),
      bonusTiers: BONUS_TIERS,
      finalizedAt: new Date("2026-01-02T00:00:00-05:00"),
    };
    // finalizedAt alone makes it complete, even before any event's closesAt — the manual override.
    expect(isGroupComplete(fourEventGroup, BEFORE)).toBe(true);
    // Attended all 4 of the events that actually exist -> the 3-4 tier, never the 5+ tier (it can't reach 5).
    expect(groupBonusFor(attended(4), fourEventGroup, BEFORE)).toBe(3);
  });

  it("an incomplete group (an event still scheduled in the future) is not complete without finalizing", () => {
    const stillRunning: GroupBonusInput = {
      events: [...GROUP_EVENTS.slice(0, 4), makeEvent({ eventId: "w5", closesAt: new Date("2026-06-01T00:00:00-05:00") })],
      bonusTiers: BONUS_TIERS,
      finalizedAt: null,
    };
    expect(isGroupComplete(stillRunning, AFTER)).toBe(false);
    expect(groupBonusFor(attended(5), stillRunning, AFTER)).toBe(0);
  });
});

describe("Monthly Engagement Champion — monthlyChampions / isMonthOver", () => {
  const SEPT_CLOSE = new Date("2026-09-15T20:00:00-04:00");

  function septAttendance(email: string, count: number, countsForMonthly = true): AttendanceRecord[] {
    return Array.from({ length: count }, (_, i) =>
      makeAttendance({
        id: `${email}-${i}`,
        email,
        closesAt: SEPT_CLOSE,
        category: makeCategory({ countsForMonthly }),
      }),
    );
  }

  it("is [] before the month is over — no provisional champion", () => {
    const registrations = septAttendance("a@x.edu", 5);
    const midMonth = new Date("2026-09-20T00:00:00-04:00");
    expect(monthlyChampions(registrations, "2026-09", { minEvents: 2 }, midMonth)).toEqual([]);
  });

  it("isMonthOver is true once the calendar has moved to the next month", () => {
    expect(isMonthOver("2026-09", new Date("2026-09-30T23:59:00-04:00"))).toBe(false);
    expect(isMonthOver("2026-09", new Date("2026-10-01T00:00:00-04:00"))).toBe(true);
  });

  it("a three-way tie for the max awards champion status to all three", () => {
    const registrations = [
      ...septAttendance("a@x.edu", 4),
      ...septAttendance("b@x.edu", 4),
      ...septAttendance("c@x.edu", 4),
      ...septAttendance("d@x.edu", 2),
    ];
    const after = new Date("2026-10-01T00:00:00-04:00");
    const champions = monthlyChampions(registrations, "2026-09", { minEvents: 2 }, after);
    expect(champions.map((c) => c.email).sort()).toEqual(["a@x.edu", "b@x.edu", "c@x.edu"]);
    expect(champions.every((c) => c.count === 4)).toBe(true);
  });

  it("a member below MONTHLY_CHAMPION_MIN_EVENTS is not champion, even as the sole max", () => {
    const registrations = septAttendance("a@x.edu", 1);
    const after = new Date("2026-10-01T00:00:00-04:00");
    expect(monthlyChampions(registrations, "2026-09", { minEvents: 2 }, after)).toEqual([]);
  });

  it("only role general and countsForMonthly categories count", () => {
    const registrations = [
      ...septAttendance("a@x.edu", 3),
      ...septAttendance("b@x.edu", 5).map((r) => ({ ...r, role: "eboard" as const })),
      ...septAttendance("c@x.edu", 5, false),
    ];
    const after = new Date("2026-10-01T00:00:00-04:00");
    const champions = monthlyChampions(registrations, "2026-09", { minEvents: 2 }, after);
    expect(champions).toEqual([{ email: "a@x.edu", count: 3 }]);
  });
});

describe("memberTotal / computeStandings — Part 4 scoring", () => {
  it("sums event points (re-derived from the live category) plus every active bonus", () => {
    const registrations = [
      makeAttendance({ eventId: "ev1", category: makeCategory() }), // 3
      makeAttendance({ eventId: "ev2", category: TIER2 }), // 2
    ];
    const groups: GroupBonusInput[] = [
      {
        events: [makeEvent({ eventId: "ev1" }), makeEvent({ eventId: "ev2" })],
        bonusTiers: [{ min: 2, max: null, bonus: 5 }],
        finalizedAt: new Date("2026-01-01T00:00:00-05:00"),
      },
    ];
    const awards = [
      makeAward({ kind: "game_competition", points: 1 }),
      makeAward({ kind: "monthly_champion", points: 5, eventId: null, periodMonth: "2025-09" }),
      makeAward({ kind: "manual", points: 2, eventId: null }),
    ];
    const breakdown = memberTotal({ role: "general" }, registrations, awards, groups, NOW);
    expect(breakdown).toEqual({
      eventPoints: 5,
      nsbeWeekBonus: 5,
      gameBonus: 1,
      monthlyChampionBonus: 5,
      manualBonus: 2,
      total: 18,
    });
  });

  it("a revoked award never contributes", () => {
    const awards = [makeAward({ kind: "game_competition", points: 1, revokedAt: NOW })];
    const breakdown = memberTotal({ role: "general" }, [], awards, [], NOW);
    expect(breakdown.gameBonus).toBe(0);
    expect(breakdown.total).toBe(0);
  });

  it("editing a category's point value changes derived totals with no backfill — the SAME registration re-scores instantly", () => {
    const registration = makeAttendance({ category: makeCategory({ memberPoints: 3 }) });
    const before = memberTotal({ role: "general" }, [registration], [], [], NOW);
    expect(before.eventPoints).toBe(3);

    // No write happened to the registration — this just reflects the category's current value on re-read.
    const afterEdit = memberTotal(
      { role: "general" },
      [{ ...registration, category: { ...registration.category, memberPoints: 5 } }],
      [],
      [],
      NOW,
    );
    expect(afterEdit.eventPoints).toBe(5);
  });

  it("ties share a rank and the next rank skips (1, 1, 3)", () => {
    const members = [
      makeMember({ email: "a@x.edu", lastName: "Adams" }),
      makeMember({ email: "b@x.edu", lastName: "Baker" }),
      makeMember({ email: "c@x.edu", lastName: "Carter" }),
    ];
    const attendance = [
      makeAttendance({ email: "a@x.edu", category: makeCategory({ memberPoints: 14 }) }),
      makeAttendance({ email: "b@x.edu", category: makeCategory({ memberPoints: 14 }) }),
      makeAttendance({ email: "c@x.edu", category: makeCategory({ memberPoints: 12 }) }),
    ];
    const standings = computeStandings(attendance, members, SEASON, [], [], NOW);
    const byEmail = Object.fromEntries(standings.map((s) => [s.email, s]));
    expect(byEmail["a@x.edu"].rank).toBe(1);
    expect(byEmail["b@x.edu"].rank).toBe(1);
    expect(byEmail["c@x.edu"].rank).toBe(3);
  });

  it("a roster role change re-filters an existing member off the board", () => {
    const attendance = [makeAttendance({ email: "a@x.edu" })];
    const before = computeStandings(attendance, [makeMember({ email: "a@x.edu", role: "general" })], SEASON, [], [], NOW);
    expect(before.some((s) => s.email === "a@x.edu")).toBe(true);

    const after = computeStandings(attendance, [makeMember({ email: "a@x.edu", role: "eboard" })], SEASON, [], [], NOW);
    expect(after.some((s) => s.email === "a@x.edu")).toBe(false);
  });

  it("an ineligible member accrues every bonus but appears nowhere on the leaderboard, with no backfill once they report", () => {
    const attendance = [makeAttendance({ email: "a@x.edu" })];
    const awards = [makeAward({ email: "a@x.edu", kind: "game_competition", points: 1 })];
    const ineligibleMember = makeMember({ email: "a@x.edu", duesPaidReported: false });

    const standings = computeStandings(attendance, [ineligibleMember], SEASON, awards, [], NOW);
    expect(standings.some((s) => s.email === "a@x.edu")).toBe(false);

    // Reporting later — same attendance/award rows, no rewrite — makes them appear with the FULL accrued total.
    const nowEligible = makeMember({ email: "a@x.edu" });
    const after = computeStandings(attendance, [nowEligible], SEASON, awards, [], NOW);
    const row = after.find((s) => s.email === "a@x.edu");
    expect(row?.points).toBe(4); // 3 event points + 1 game bonus
  });

  it("an EBOARD member who reports dues and national membership still never appears on the member leaderboard", () => {
    const attendance = [makeAttendance({ email: "a@x.edu" })];
    // Collecting the data at signup is what changed; who scores is not.
    // Fully reported for the current season — isEligible(officer) is true —
    // and still filtered off the board by role alone.
    const officer = makeMember({
      email: "a@x.edu",
      role: "eboard",
      duesPaidReported: true,
      nationalMemberReported: true,
      membershipSeason: SEASON,
    });
    expect(isEligible(officer, SEASON)).toBe(true);

    const standings = computeStandings(attendance, [officer], SEASON, [], [], NOW);
    expect(standings.some((s) => s.email === "a@x.edu")).toBe(false);
    expect(memberPointsFor(officer, makeEvent(), makeCategory())).toBe(0);
  });

  it("a stale membershipSeason makes an otherwise-fully-reported member ineligible", () => {
    const attendance = [makeAttendance({ email: "a@x.edu" })];
    const standings = computeStandings(
      attendance,
      [makeMember({ email: "a@x.edu", membershipSeason: "2025-2026" })],
      SEASON,
      [],
      [],
      NOW,
    );
    expect(standings.some((s) => s.email === "a@x.edu")).toBe(false);
  });
});

describe("isEligible", () => {
  it("both self-report flags true, matching season, no verification fields set — eligible", () => {
    expect(
      isEligible(
        makeMember({ duesVerifiedAt: null, nationalVerifiedAt: null, duesPaidReported: true, nationalMemberReported: true }),
        SEASON,
      ),
    ).toBe(true);
  });

  it("requires both flags", () => {
    expect(isEligible(makeMember({ duesPaidReported: false }), SEASON)).toBe(false);
    expect(isEligible(makeMember({ nationalMemberReported: false }), SEASON)).toBe(false);
  });

  it("a stale membershipSeason fails eligibility even with both flags true", () => {
    expect(isEligible(makeMember({ membershipSeason: "2025-2026" }), SEASON)).toBe(false);
  });

  it("an unset Config.SEASON never matches an unset membershipSeason", () => {
    expect(
      isEligible({ duesPaidReported: true, nationalMemberReported: true, membershipSeason: "" }, ""),
    ).toBe(false);
  });

  /**
   * The guard on the claim-state display fix: making the roster tell a
   * self-report apart from a verification must not move one person on or off
   * the leaderboard. Eligibility reads the REPORTED flags and the season, and
   * nothing else — every combination of verify/revoke stamps over the same
   * reported flags gives the same answer.
   */
  it("is identical across all four claim states for the same reported flags", () => {
    const NOW2 = new Date("2026-09-11T00:00:00Z");
    const reportedTrue = { duesPaidReported: true, nationalMemberReported: true };
    const variants = [
      { label: "pending", ...reportedTrue, duesVerifiedAt: null, nationalVerifiedAt: null, duesRevokedAt: null, nationalRevokedAt: null },
      { label: "verified", ...reportedTrue, duesVerifiedAt: NOW2, nationalVerifiedAt: NOW2, duesRevokedAt: null, nationalRevokedAt: null },
      { label: "stale revoke stamp", ...reportedTrue, duesVerifiedAt: null, nationalVerifiedAt: null, duesRevokedAt: NOW2, nationalRevokedAt: NOW2 },
    ];
    for (const v of variants) {
      expect(isEligible(makeMember(v), SEASON), `${v.label} must not change eligibility`).toBe(true);
    }
  });

  it("a revoked claim drops the member only because revoke sets the REPORTED flag false, not because of the stamp", () => {
    const stampOnly = makeMember({ duesRevokedAt: new Date(), duesPaidReported: true });
    expect(isEligible(stampOnly, SEASON)).toBe(true);

    // What revokeDues actually writes: reported false AND the stamp.
    const reallyRevoked = makeMember({ duesRevokedAt: new Date(), duesPaidReported: false });
    expect(isEligible(reallyRevoked, SEASON)).toBe(false);
  });
});

const EBOARD_CONFIG: EboardStandingsConfig = {
  EBOARD_POINT_VALUE: "1",
  EBOARD_TRACK_ENABLED: true,
  requireMembership: false,
  currentSeason: SEASON,
};

describe("eboardAwardFor", () => {
  it("0 unless role is eboard", () => {
    expect(eboardAwardFor("general", EBOARD_MEETING, EBOARD_CONFIG)).toBe(0);
    expect(eboardAwardFor("guest", EBOARD_MEETING, EBOARD_CONFIG)).toBe(0);
  });

  it("0 unless the category is eboardEligible", () => {
    expect(eboardAwardFor("eboard", { eboardEligible: false }, EBOARD_CONFIG)).toBe(0);
  });

  it("0 when the track is disabled, regardless of role or category", () => {
    expect(eboardAwardFor("eboard", EBOARD_MEETING, { ...EBOARD_CONFIG, EBOARD_TRACK_ENABLED: false })).toBe(0);
  });

  it("otherwise pays EBOARD_POINT_VALUE, changeable with no code change", () => {
    expect(eboardAwardFor("eboard", EBOARD_MEETING, EBOARD_CONFIG)).toBe(1);
    expect(eboardAwardFor("eboard", EBOARD_MEETING, { ...EBOARD_CONFIG, EBOARD_POINT_VALUE: "2" })).toBe(2);
  });
});

describe("computeEboardStandings — explicitly excluded from all of Part 1-3", () => {
  it("ties share a rank and the next rank skips (1, 1, 3) — same rankRows helper as computeStandings", () => {
    const users = [
      makeMember({ email: "a@x.edu", lastName: "Adams", role: "eboard" }),
      makeMember({ email: "b@x.edu", lastName: "Baker", role: "eboard" }),
      makeMember({ email: "c@x.edu", lastName: "Carter", role: "eboard" }),
    ];
    const attendance = [
      makeAttendance({ email: "a@x.edu", eventId: "ev-a", category: EBOARD_MEETING }),
      makeAttendance({ email: "a@x.edu", eventId: "ev-b", category: EBOARD_MEETING }),
      makeAttendance({ email: "b@x.edu", eventId: "ev-a", category: EBOARD_MEETING }),
      makeAttendance({ email: "b@x.edu", eventId: "ev-b", category: EBOARD_MEETING }),
      makeAttendance({ email: "c@x.edu", eventId: "ev-a", category: EBOARD_MEETING }),
    ];
    const standings = computeEboardStandings(attendance, users, EBOARD_CONFIG);
    const byEmail = Object.fromEntries(standings.map((s) => [s.email, s]));
    expect(byEmail["a@x.edu"]).toMatchObject({ points: 2, rank: 1 });
    expect(byEmail["b@x.edu"]).toMatchObject({ points: 2, rank: 1 });
    expect(byEmail["c@x.edu"]).toMatchObject({ points: 1, rank: 3 });
  });

  it("an EBOARD user earns exactly +1 per qualifying activity regardless of any awards or group attendance — no bonus logic reaches this track", () => {
    const users = [makeMember({ email: "a@x.edu", role: "eboard" })];
    // Attends 3 GBM-shaped (tier 1, 3pts) events plus one E-Board meeting — the
    // member track's tiers must NEVER leak into the eboard total, which stays
    // flat EBOARD_POINT_VALUE per row regardless of category tier/points.
    const attendance = [
      makeAttendance({ email: "a@x.edu", eventId: "ev1", category: makeCategory() }),
      makeAttendance({ email: "a@x.edu", eventId: "ev2", category: makeCategory() }),
      makeAttendance({ email: "a@x.edu", eventId: "ev3", category: makeCategory() }),
      makeAttendance({ email: "a@x.edu", eventId: "ev4", category: EBOARD_MEETING }),
    ];
    // These would add game/monthly-champion/NSBE-Week bonuses on the MEMBER
    // track — computeEboardStandings doesn't even accept these parameters,
    // which is itself part of the guarantee, but assert the actual number too.
    const standings = computeEboardStandings(attendance, users, EBOARD_CONFIG);
    expect(standings).toEqual([{ email: "a@x.edu", firstName: "A", lastName: "Aaronson", points: 4, events: 4, rank: 1 }]);
  });

  it("only current-role EBOARD users appear, regardless of the role frozen on the attendance row", () => {
    const users = [makeMember({ email: "a@x.edu", role: "general" })];
    const attendance = [makeAttendance({ email: "a@x.edu", eventId: "ev-a", role: "eboard", category: EBOARD_MEETING })];
    expect(computeEboardStandings(attendance, users, EBOARD_CONFIG)).toHaveLength(0);
  });

  it("a category with eboardEligible false contributes nothing to the internal track", () => {
    const users = [makeMember({ email: "a@x.edu", role: "eboard" })];
    const attendance = [makeAttendance({ email: "a@x.edu", eventId: "ev-a", category: makeCategory({ eboardEligible: false }) })];
    expect(computeEboardStandings(attendance, users, EBOARD_CONFIG)[0]).toMatchObject({ points: 0, events: 1 });
  });

  it("EBOARD_REQUIRES_MEMBERSHIP gates on isEligible when turned on", () => {
    const users = [makeMember({ email: "a@x.edu", role: "eboard", duesPaidReported: false })];
    const attendance = [makeAttendance({ email: "a@x.edu", eventId: "ev-a", category: EBOARD_MEETING })];
    expect(computeEboardStandings(attendance, users, EBOARD_CONFIG)).toHaveLength(1);
    expect(computeEboardStandings(attendance, users, { ...EBOARD_CONFIG, requireMembership: true })).toHaveLength(0);
  });
});

describe("summaryFor / hasRegistered", () => {
  it("summaryFor gives a general member with no attendance 0 points but still a rank", () => {
    const members = [makeMember({ email: "a@x.edu" })];
    const standings = computeStandings([], members, SEASON, [], [], NOW);
    const summary = summaryFor("a@x.edu", standings);
    expect(summary.points).toBe(0);
    expect(summary.rank).toBe(1);
  });

  it("summaryFor returns a null rank for someone not on the standings at all", () => {
    const members = [makeMember({ email: "a@x.edu" })];
    const standings = computeStandings([], members, SEASON, [], [], NOW);
    const summary = summaryFor("nobody@x.edu", standings);
    expect(summary.points).toBe(0);
    expect(summary.rank).toBeNull();
  });

  it("hasRegistered is case-insensitive on email and scoped to the event", () => {
    const attendance = [makeAttendance({ eventId: "ev1", email: "a@x.edu" })];
    expect(hasRegistered(attendance, "ev1", "A@X.EDU")).toBe(true);
    expect(hasRegistered(attendance, "ev2", "a@x.edu")).toBe(false);
  });
});

describe("standingsCacheTag", () => {
  it("is a pure function of orgId and season", () => {
    expect(standingsCacheTag("org-1", "2026-2027")).toBe("standings:org-1:2026-2027");
    expect(standingsCacheTag("org-1", "2026-2027")).toBe(standingsCacheTag("org-1", "2026-2027"));
    expect(standingsCacheTag("org-1", "2025-2026")).not.toBe(standingsCacheTag("org-1", "2026-2027"));
  });
});

describe("rankWithLiveSelf — the dashboard's own-row rank against an otherwise-cached board", () => {
  it("slots a fresh total into an (up to 30s stale) cached board and ranks it exactly like computeStandings would", () => {
    const members = [makeMember({ email: "a@x.edu", lastName: "Adams" }), makeMember({ email: "b@x.edu", lastName: "Baker" })];
    const attendance = [makeAttendance({ eventId: "ev1", email: "b@x.edu" }), makeAttendance({ eventId: "ev1", email: "b@x.edu" })];
    // Cached board: b has 2 events worth of points, a has 0 — a is behind.
    const cached = computeStandings(attendance, members, SEASON, [], [], NOW);

    // a just checked in live — their fresh total now beats b's cached total.
    const rank = rankWithLiveSelf(cached, { email: "a@x.edu", firstName: "Test", lastName: "Adams", points: 999, events: 1 });
    expect(rank).toBe(1);
  });

  it("replaces (not duplicates) the caller's own stale row in the cached board", () => {
    const members = [makeMember({ email: "a@x.edu", lastName: "Adams" }), makeMember({ email: "b@x.edu", lastName: "Baker" })];
    const cached = computeStandings([], members, SEASON, [], [], NOW);

    // a's live total (5) is fed in fresh — a's own stale (0-point) cached row must not also count separately.
    const rank = rankWithLiveSelf(cached, { email: "a@x.edu", firstName: "Test", lastName: "Adams", points: 5, events: 1 });
    expect(rank).toBe(1); // beats b's cached 0 points, and isn't tied with its own stale entry
  });

  it("inserts a member not yet present in the cached board (e.g. just became eligible)", () => {
    const members = [makeMember({ email: "a@x.edu", lastName: "Adams" })];
    const cached = computeStandings([], members, SEASON, [], [], NOW); // only "a" on the board

    const rank = rankWithLiveSelf(cached, { email: "new@x.edu", firstName: "New", lastName: "Zzz", points: 0, events: 0 });
    expect(rank).toBe(1); // tied at 0 points, "a" sorts first by lastName but ties share rank 1
  });
});

describe("isOpen", () => {
  const opensAt = new Date("2026-01-01T18:00:00-05:00");
  const closesAt = new Date("2026-01-01T19:00:00-05:00");

  it("draft events are never open", () => {
    const event = makeEvent({ status: "draft", opensAt, closesAt });
    expect(isOpen(event, opensAt)).toBe(false);
  });

  it("canceled events are never open", () => {
    const event = makeEvent({ status: "canceled", opensAt, closesAt });
    expect(isOpen(event, opensAt)).toBe(false);
  });

  it("is false before opensAt", () => {
    const event = makeEvent({ opensAt, closesAt });
    expect(isOpen(event, new Date(opensAt.getTime() - 1))).toBe(false);
  });

  it("is false after closesAt", () => {
    const event = makeEvent({ opensAt, closesAt });
    expect(isOpen(event, new Date(closesAt.getTime() + 1))).toBe(false);
  });

  it("boundaries are inclusive", () => {
    const event = makeEvent({ opensAt, closesAt });
    expect(isOpen(event, opensAt)).toBe(true);
    expect(isOpen(event, closesAt)).toBe(true);
  });

  it("missing opensAt/closesAt is never open", () => {
    expect(isOpen(makeEvent({ opensAt: null, closesAt }), opensAt)).toBe(false);
    expect(isOpen(makeEvent({ opensAt, closesAt: null }), opensAt)).toBe(false);
  });
});

describe("msRemaining / closedRecently", () => {
  const opensAt = new Date("2026-01-01T18:00:00-05:00");
  const closesAt = new Date("2026-01-01T19:00:00-05:00");

  it("msRemaining is 0 when not open", () => {
    const event = makeEvent({ status: "draft", opensAt, closesAt });
    expect(msRemaining(event, opensAt)).toBe(0);
  });

  it("msRemaining counts down to closesAt while open", () => {
    const event = makeEvent({ opensAt, closesAt });
    const mid = new Date(opensAt.getTime() + 10 * 60_000);
    expect(msRemaining(event, mid)).toBe(closesAt.getTime() - mid.getTime());
  });

  it("closedRecently is true just after closesAt and false long after", () => {
    const event = makeEvent({ opensAt, closesAt });
    expect(closedRecently(event, new Date(closesAt.getTime() + 60_000))).toBe(true);
    expect(closedRecently(event, new Date(closesAt.getTime() + 25 * 60 * 60_000))).toBe(false);
    expect(closedRecently(event, opensAt)).toBe(false); // not closed yet
  });
});

describe("attendanceRate", () => {
  const joinedAt = new Date("2026-02-01T00:00:00-05:00");

  function makeEligibilityEvent(id: string, overrides: Partial<{ openedAt: Date | null; closesAt: Date | null }> = {}) {
    return {
      eventId: id,
      openedAt: "openedAt" in overrides ? overrides.openedAt! : new Date("2026-02-15T00:00:00-05:00"),
      closesAt: "closesAt" in overrides ? overrides.closesAt! : new Date("2026-02-15T01:00:00-05:00"),
    };
  }

  it("excludes an event that closed before the account was created", () => {
    const before = makeEligibilityEvent("before", { closesAt: new Date("2026-01-15T00:00:00-05:00") });
    const after = makeEligibilityEvent("after");
    const result = attendanceRate([], [before, after], joinedAt);
    expect(result.eligible).toBe(1);
  });

  it("includes an event that closed after the account was created", () => {
    const after = makeEligibilityEvent("after");
    const result = attendanceRate([], [after], joinedAt);
    expect(result.eligible).toBe(1);
  });

  it("excludes a scheduled-but-never-opened event", () => {
    const neverOpened = makeEligibilityEvent("never", { openedAt: null });
    const result = attendanceRate([], [neverOpened], joinedAt);
    expect(result.eligible).toBe(0);
  });

  it("attended counts only registrations within the eligible set", () => {
    const eligible = makeEligibilityEvent("eligible");
    const before = makeEligibilityEvent("before", { closesAt: new Date("2026-01-15T00:00:00-05:00") });
    const history = [
      makeAttendance({ eventId: "eligible" }),
      makeAttendance({ eventId: "before" }), // shouldn't count even though attended — it predates the account
    ];
    const result = attendanceRate(history, [eligible, before], joinedAt);
    expect(result).toEqual({ attended: 1, eligible: 1 });
  });
});

describe("longestAttendanceStreak", () => {
  it("a miss resets the streak — longest run wins", () => {
    const events = [{ eventId: "1" }, { eventId: "2" }, { eventId: "3" }, { eventId: "4" }, { eventId: "5" }, { eventId: "6" }];
    const attended = new Set(["1", "2", "3", "5", "6"]); // missed 4
    expect(longestAttendanceStreak(events, attended)).toBe(3);
  });

  it("0 when nothing was attended", () => {
    expect(longestAttendanceStreak([{ eventId: "1" }], new Set())).toBe(0);
  });
});

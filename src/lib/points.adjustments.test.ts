/**
 * Point adjustments in the pure scoring layer — lib/points.ts, no database.
 * The repo-level tests (repo.adjustments.test.ts) cover the same rules end to
 * end; these pin down the arithmetic and the ranking rules on their own.
 */

import { describe, expect, it } from "vitest";
import {
  awardCountsForSeason,
  computeEboardStandings,
  computeStandings,
  displayTotal,
  groupBonusFor,
  memberTotal,
  monthlyChampions,
  projectStandings,
} from "./points";
import type { AttendanceRecord, EventCategory, Member, PointAward, Standing } from "./types";

const SEASON = "2026-2027";
const NOW = new Date("2026-11-15T12:00:00-05:00");

const CATEGORY: EventCategory = {
  id: "c1",
  code: "GBM",
  name: "GBM",
  shortName: "GBM",
  tier: 1,
  memberPoints: 2,
  examples: "",
  countsForMonthly: true,
  eboardEligible: true,
  audience: "all",
  active: true,
  sortOrder: 0,
};

function member(email: string, overrides: Partial<Member> = {}): Member {
  return {
    id: email,
    email,
    firstName: email.split("@")[0],
    lastName: email.split("@")[0],
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
    duesReportedAt: null,
    duesVerifiedAt: null,
    duesVerifiedById: "",
    duesRevokedAt: null,
    duesRevokedById: "",
    duesRevokedNote: "",
    nationalMemberReported: true,
    nsbeMembershipId: "",
    nationalVerifiedAt: null,
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
    signupCompletedAt: null,
    ...overrides,
  };
}

/** `n` check-ins worth 2 points each, closing in October 2026. */
function attended(email: string, n: number, role: AttendanceRecord["role"] = "general"): AttendanceRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${email}-${i}`,
    timestamp: new Date("2026-10-05T18:00:00-04:00"),
    eventId: `ev${i}`,
    email,
    role,
    pointsAwarded: 2,
    source: "form",
    note: "",
    eventPointsOverride: null,
    closesAt: new Date(`2026-10-${String(5 + i).padStart(2, "0")}T19:00:00-04:00`),
    category: CATEGORY,
  }));
}

function adjustment(email: string, points: number, overrides: Partial<PointAward> = {}): PointAward {
  return {
    id: `adj-${email}-${points}-${Math.random()}`,
    email,
    kind: "adjustment",
    points,
    eventId: null,
    periodMonth: null,
    reason: "Checked in for someone else at the GBM",
    awardedById: "",
    awardedAt: NOW,
    revokedAt: null,
    revokedById: "",
    revokeNote: "",
    season: SEASON,
    relatedEventId: null,
    ...overrides,
  };
}

const ranks = (standings: Standing[]) => Object.fromEntries(standings.map((s) => [s.email, s.rank]));
const pointsOf = (standings: Standing[]) => Object.fromEntries(standings.map((s) => [s.email, s.points]));

describe("adjustments in memberTotal", () => {
  it("sums into their own `adjustments` line, and a negative one reduces the total", () => {
    const b = memberTotal({ role: "general" }, attended("a@x.edu", 3), [adjustment("a@x.edu", -3)], [], NOW, SEASON);
    expect(b.eventPoints).toBe(6);
    expect(b.adjustments).toBe(-3);
    expect(b.total).toBe(3);
  });

  it("two adjustments on the same member are independent and both apply — there is no replace", () => {
    const b = memberTotal(
      { role: "general" },
      [],
      [adjustment("a@x.edu", -3), adjustment("a@x.edu", 5)],
      [],
      NOW,
      SEASON,
    );
    expect(b.adjustments).toBe(2);
  });

  it("the total may go below zero — the stored/computed value is never clamped", () => {
    const b = memberTotal({ role: "general" }, attended("a@x.edu", 2), [adjustment("a@x.edu", -10)], [], NOW, SEASON);
    expect(b.total).toBe(-6);
  });

  it("a revoked adjustment contributes nothing, so revoking restores the previous total exactly", () => {
    const before = memberTotal({ role: "general" }, attended("a@x.edu", 3), [], [], NOW, SEASON);
    const revoked = memberTotal(
      { role: "general" },
      attended("a@x.edu", 3),
      [adjustment("a@x.edu", -5, { revokedAt: NOW })],
      [],
      NOW,
      SEASON,
    );
    expect(revoked).toEqual(before);
  });
});

describe("displayTotal — member-facing clamp", () => {
  it("clamps a negative total at 0 and leaves everything else alone", () => {
    expect(displayTotal(-6)).toBe(0);
    expect(displayTotal(0)).toBe(0);
    expect(displayTotal(14)).toBe(14);
  });
});

describe("ranking with adjustments", () => {
  it("a negative adjustment changes rank", () => {
    const members = [member("a@x.edu"), member("b@x.edu"), member("c@x.edu")];
    const attendance = [...attended("a@x.edu", 5), ...attended("b@x.edu", 4), ...attended("c@x.edu", 3)];
    const before = computeStandings(attendance, members, SEASON, [], [], NOW);
    expect(ranks(before)).toEqual({ "a@x.edu": 1, "b@x.edu": 2, "c@x.edu": 3 });

    const after = computeStandings(attendance, members, SEASON, [adjustment("a@x.edu", -5)], [], NOW);
    expect(pointsOf(after)["a@x.edu"]).toBe(5);
    expect(ranks(after)).toEqual({ "b@x.edu": 1, "c@x.edu": 2, "a@x.edu": 3 });
  });

  it("negative and zero totals use standard competition ranking — ties share a rank, the next rank skips", () => {
    const members = ["a", "b", "c", "d", "e"].map((n) => member(`${n}@x.edu`));
    const attendance = attended("a@x.edu", 2); // a: 4
    const awards = [
      adjustment("c@x.edu", -2), // c: -2
      adjustment("d@x.edu", -2), // d: -2
      adjustment("e@x.edu", -5), // e: -5
    ]; // b: 0
    const standings = computeStandings(attendance, members, SEASON, awards, [], NOW);
    expect(standings.map((s) => [s.email, s.points, s.rank])).toEqual([
      ["a@x.edu", 4, 1],
      ["b@x.edu", 0, 2],
      ["c@x.edu", -2, 3],
      ["d@x.edu", -2, 3],
      ["e@x.edu", -5, 5],
    ]);
  });

  it("several members on 0 share a rank above anyone negative", () => {
    const members = ["a", "b", "c"].map((n) => member(`${n}@x.edu`));
    const standings = computeStandings([], members, SEASON, [adjustment("c@x.edu", -1)], [], NOW);
    expect(ranks(standings)).toEqual({ "a@x.edu": 1, "b@x.edu": 1, "c@x.edu": 3 });
  });

  it("an ineligible member's adjustment is recorded but they stay off the board, like any other points", () => {
    const members = [member("a@x.edu"), member("b@x.edu", { duesPaidReported: false })];
    const standings = computeStandings([], members, SEASON, [adjustment("b@x.edu", 50)], [], NOW);
    expect(standings.map((s) => s.email)).toEqual(["a@x.edu"]);
    // ...and the breakdown still has it, ready for when they report.
    expect(memberTotal(members[1], [], [adjustment("b@x.edu", 50)], [], NOW, SEASON).adjustments).toBe(50);
  });
});

describe("season scoping", () => {
  it("an adjustment counts only in the season it was made in", () => {
    expect(awardCountsForSeason({ kind: "adjustment", season: SEASON }, SEASON)).toBe(true);
    expect(awardCountsForSeason({ kind: "adjustment", season: SEASON }, "2027-2028")).toBe(false);
    // An unset season never matches — same guard as isEligible.
    expect(awardCountsForSeason({ kind: "adjustment", season: "" }, "")).toBe(false);
    // Every other kind keeps its existing, unscoped behavior.
    expect(awardCountsForSeason({ kind: "manual", season: null }, "2027-2028")).toBe(true);
  });

  it("a season rollover drops the adjustment from the total", () => {
    const awards = [adjustment("a@x.edu", -4)];
    expect(memberTotal({ role: "general" }, attended("a@x.edu", 3), awards, [], NOW, SEASON).total).toBe(2);
    expect(memberTotal({ role: "general" }, attended("a@x.edu", 3), awards, [], NOW, "2027-2028").total).toBe(6);
  });
});

describe("adjustments never reach the attendance-derived results", () => {
  it("Monthly Champion is computed from attendance alone — monthlyChampions has no award input at all", () => {
    // Structural: the function's inputs are registrations, a month, a config and a clock.
    expect(monthlyChampions.length).toBe(4);
    const regs = [...attended("a@x.edu", 3), ...attended("b@x.edu", 2)];
    const champs = monthlyChampions(regs, "2026-10", { minEvents: 2 }, NOW);
    expect(champs).toEqual([{ email: "a@x.edu", count: 3 }]);
  });

  it("the NSBE Week bonus is computed from attendance alone — groupBonusFor has no award input at all", () => {
    expect(groupBonusFor.length).toBe(3);
  });

  it("the internal E-Board board never receives awards, so an adjustment can't move it", () => {
    expect(computeEboardStandings.length).toBe(3);
    const officer = member("o@x.edu", { role: "eboard" });
    const board = computeEboardStandings(attended("o@x.edu", 3, "eboard"), [officer], {
      EBOARD_POINT_VALUE: "1",
      EBOARD_TRACK_ENABLED: true,
      requireMembership: false,
      currentSeason: SEASON,
    });
    expect(board[0].points).toBe(3);
  });
});

describe("projectStandings — the impact preview's projected rank", () => {
  const board: Standing[] = [
    { email: "a@x.edu", firstName: "a", lastName: "a", points: 10, events: 5, rank: 1 },
    { email: "b@x.edu", firstName: "b", lastName: "b", points: 8, events: 4, rank: 2 },
    { email: "c@x.edu", firstName: "c", lastName: "c", points: 6, events: 3, rank: 3 },
    { email: "d@x.edu", firstName: "d", lastName: "d", points: 4, events: 2, rank: 4 },
  ];

  it("re-ranks with the delta applied — a -5 drops the leader from 1st to 3rd", () => {
    const projected = projectStandings(board, new Map([["a@x.edu", -5]]));
    expect(ranks(projected)).toEqual({ "b@x.edu": 1, "c@x.edu": 2, "a@x.edu": 3, "d@x.edu": 4 });
  });

  it("applies every target's delta at once for a bulk adjustment", () => {
    const projected = projectStandings(
      board,
      new Map([
        ["a@x.edu", -10],
        ["b@x.edu", -10],
      ]),
    );
    expect(ranks(projected)).toEqual({ "c@x.edu": 1, "d@x.edu": 2, "a@x.edu": 3, "b@x.edu": 4 });
  });

  it("ignores a delta for someone who isn't on the board", () => {
    expect(ranks(projectStandings(board, new Map([["z@x.edu", 100]])))).toEqual(ranks(board));
  });
});

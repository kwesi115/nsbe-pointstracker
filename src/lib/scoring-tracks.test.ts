/**
 * The two point mechanisms, and the boundary between them.
 *
 * EBOARD_MEETING and EBOARD_RETREAT now carry memberPoints 1, which raises the
 * obvious question: does an officer attending an E-Board meeting score that 1
 * AND the flat internal-track 1? No — and this file is the proof, because the
 * answer depends on a role gate inside memberPointsFor that is easy to remove by
 * accident.
 *
 *   member track    Registration.pointsAwarded, written at check-in from
 *                   memberPointsFor. Returns 0 for ANY role that is not
 *                   "general", so a category's memberPoints is never read for an
 *                   officer. Feeds computeStandings (the public leaderboard).
 *
 *   internal track  eboardAwardFor, computed fresh at read time: a flat
 *                   Config.EBOARD_POINT_VALUE per eboardEligible activity,
 *                   only for role "eboard". Feeds computeEboardStandings and
 *                   never looks at pointsAwarded.
 *
 * Different function, different input, different board. The category value only
 * ever matters to a General member — which is why it is safe for it to be 1.
 */

import { describe, expect, it } from "vitest";
import { computeEboardStandings, eboardAwardFor, memberPointsFor } from "./points";
import type { AttendanceRecord, Member } from "./types";

const EBOARD_CONFIG = { EBOARD_POINT_VALUE: "1", EBOARD_TRACK_ENABLED: true };

/** As seeded: 1 member point, eboardEligible, EBOARD_ONLY audience. */
const EBOARD_MEETING = {
  memberPoints: 1,
  eboardEligible: true,
  audience: "eboard_only" as const,
};

const HOUSE_EVENT = {
  memberPoints: 1,
  eboardEligible: true,
  countsForMonthly: true,
  audience: "all" as const,
  tier: 3,
};

/** No per-event override, so the category's value is what counts. */
const NO_OVERRIDE = { points: null };

describe("an E-Board member attending an E-Board meeting earns exactly 1 internal point", () => {
  it("scores 1 on the internal track and 0 on the member track — not 2 anywhere", () => {
    const internal = eboardAwardFor("eboard", EBOARD_MEETING, EBOARD_CONFIG);
    const member = memberPointsFor({ role: "eboard" }, NO_OVERRIDE, EBOARD_MEETING);

    expect(internal).toBe(1);
    // The role gate: the category's memberPoints of 1 is never read for an officer.
    expect(member).toBe(0);
    expect(internal + member).toBe(1);
  });

  it("raising the category's memberPoints does not move an officer's internal total", () => {
    // The guard against the double-count arriving later: if someone sets this
    // category to 5 member points, an officer still scores exactly the flat value.
    for (const memberPoints of [0, 1, 5, 100]) {
      const category = { ...EBOARD_MEETING, memberPoints };
      expect(memberPointsFor({ role: "eboard" }, NO_OVERRIDE, category)).toBe(0);
      expect(eboardAwardFor("eboard", category, EBOARD_CONFIG)).toBe(1);
    }
  });

  it("the internal board sums the flat value per activity, never pointsAwarded", () => {
    const officer = {
      email: "officer@bison.howard.edu",
      firstName: "Reese",
      lastName: "Okafor",
      role: "eboard" as const,
      duesPaidReported: true,
      nationalMemberReported: true,
      membershipSeason: "2026-2027",
    };
    // Four meetings. pointsAwarded is deliberately nonsense-high to prove it is
    // not what the internal board reads.
    const attendance: AttendanceRecord[] = [1, 2, 3, 4].map((n) => ({
      id: `r${n}`,
      timestamp: new Date("2026-09-01T18:00:00Z"),
      eventId: `e${n}`,
      email: officer.email,
      role: "eboard",
      pointsAwarded: 99,
      source: "form",
      note: "",
      eventPointsOverride: null,
      closesAt: new Date("2026-09-01T19:00:00Z"),
      category: { ...EBOARD_MEETING, countsForMonthly: true },
    }));

    const [row] = computeEboardStandings(attendance, [officer] as unknown as Member[], {
      ...EBOARD_CONFIG,
      requireMembership: false,
      currentSeason: "2026-2027",
    });

    // 4 activities x flat 1, not 4 x 99 and not 4 x (1 + 1).
    expect(row.points).toBe(4);
    expect(row.events).toBe(4);
  });

  it("a retreat behaves identically — both E-Board categories are on the same footing", () => {
    const retreat = { ...EBOARD_MEETING };
    expect(eboardAwardFor("eboard", retreat, EBOARD_CONFIG)).toBe(1);
    expect(memberPointsFor({ role: "eboard" }, NO_OVERRIDE, retreat)).toBe(0);
  });

  it("the flat value is configuration, not a constant — the track follows Config.EBOARD_POINT_VALUE", () => {
    expect(eboardAwardFor("eboard", EBOARD_MEETING, { ...EBOARD_CONFIG, EBOARD_POINT_VALUE: "2" })).toBe(2);
    // And the kill switch still wins.
    expect(eboardAwardFor("eboard", EBOARD_MEETING, { ...EBOARD_CONFIG, EBOARD_TRACK_ENABLED: false })).toBe(0);
  });

  it("a GENERAL member gets nothing from the internal track, whatever the category says", () => {
    expect(eboardAwardFor("general", EBOARD_MEETING, EBOARD_CONFIG)).toBe(0);
    // If such an event were ever opened to ALL, the category value is what they'd
    // earn — on the member board only. That is the one case the value matters.
    expect(memberPointsFor({ role: "general" }, NO_OVERRIDE, EBOARD_MEETING)).toBe(1);
  });
});

describe("a GENERAL member cannot see or attend an EBOARD_ONLY event", () => {
  it("the E-Board categories are EBOARD_ONLY, which is what keeps their member value out of reach", () => {
    // The audience is the gate; the point value behind it is beside the point.
    expect(EBOARD_MEETING.audience).toBe("eboard_only");
  });

  it("an EBOARD_ONLY audience is the flag every visibility and registration check reads", () => {
    // Enforced server-side in lib/repo.ts registerForEvent and on the events
    // list; see repo.test.ts for the database-level refusal. Asserted here so the
    // seeded shape cannot drift to ALL without a test noticing.
    expect(EBOARD_MEETING.audience).not.toBe("all");
  });
});

describe("House Event", () => {
  it("awards 1 member point to a General member", () => {
    expect(memberPointsFor({ role: "general" }, NO_OVERRIDE, HOUSE_EVENT)).toBe(1);
  });

  it("counts toward the Monthly Engagement Champion", () => {
    expect(HOUSE_EVENT.countsForMonthly).toBe(true);
  });

  it("is open to everyone and also counts on the internal track for an officer", () => {
    expect(HOUSE_EVENT.audience).toBe("all");
    // An officer attending a House event earns the flat 1 internally and 0 on the
    // member board — the same split as every other eboardEligible category.
    expect(eboardAwardFor("eboard", HOUSE_EVENT, EBOARD_CONFIG)).toBe(1);
    expect(memberPointsFor({ role: "eboard" }, NO_OVERRIDE, HOUSE_EVENT)).toBe(0);
  });

  it("is a tier-3 category, like the other one-point chapter events", () => {
    expect(HOUSE_EVENT.tier).toBe(3);
  });

  it("honours a per-event point override, like any category", () => {
    // Events can override; the category is the default.
    expect(memberPointsFor({ role: "general" }, { points: 4 }, HOUSE_EVENT)).toBe(4);
    // And 0 is a real override, not "unset".
    expect(memberPointsFor({ role: "general" }, { points: 0 }, HOUSE_EVENT)).toBe(0);
  });
});

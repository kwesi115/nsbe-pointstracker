import { describe, expect, it } from "vitest";
import { claimState, CLAIM_STATE_LABEL, type ClaimState } from "./claim-state";
import { isEligible } from "./points";
import type { Member } from "./types";

const NOW = new Date("2026-09-10T12:00:00Z");
const LATER = new Date("2026-09-11T12:00:00Z");

describe("claimState — the four states", () => {
  it("null or false reported, with no admin decision, is 'none'", () => {
    expect(claimState(null, null, null)).toBe("none");
    expect(claimState(false, null, null)).toBe("none");
    expect(claimState(undefined, null, null)).toBe("none");
  });

  it("reported true with no admin decision is 'pending' — self-reported, NOT verified", () => {
    expect(claimState(true, null, null)).toBe("pending");
  });

  it("a verification timestamp is 'verified'", () => {
    expect(claimState(true, NOW, null)).toBe("verified");
  });

  it("a revoke timestamp is 'revoked'", () => {
    // revokeDues flips reported to false at the same time it stamps the
    // revoke, so this is the shape a revoked row actually has on disk.
    expect(claimState(false, null, NOW)).toBe("revoked");
  });

  // This is the entire bug, stated as an assertion: the flag the member sets
  // and the flag an admin sets are different states, and nothing may collapse
  // them.
  it("self-reported and verified are DIFFERENT states for the same reported flag", () => {
    const selfReported = claimState(true, null, null);
    const verified = claimState(true, NOW, null);
    expect(selfReported).not.toBe(verified);
    expect(CLAIM_STATE_LABEL[selfReported]).not.toBe(CLAIM_STATE_LABEL[verified]);
  });

  it("all four labels are distinct — no two states can be rendered as the same word", () => {
    const labels = Object.values(CLAIM_STATE_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("verified wins over a leftover revoke stamp (verifyDues clears it, but precedence is defined either way)", () => {
    expect(claimState(true, LATER, NOW)).toBe("verified");
  });

  it("a claim re-reported after a revoke, with the stamp cleared, is pending again — a new claim awaiting a new decision", () => {
    // The writers clear the revoke stamps on a fresh "yes" (see
    // setDuesReported). If they did not, this row would read "revoked", the
    // pending-only audit queue would never surface it, and the member would
    // sit on the leaderboard with a claim no admin could reach.
    expect(claimState(true, null, null)).toBe("pending");
  });
});

describe("claim state never touches leaderboard eligibility", () => {
  function member(overrides: Partial<Member>): Pick<Member, "duesPaidReported" | "nationalMemberReported" | "membershipSeason"> {
    return {
      duesPaidReported: true,
      nationalMemberReported: true,
      membershipSeason: "2026-2027",
      ...overrides,
    } as Member;
  }

  // The display fix must not move a single person on or off the board.
  it("a pending (unverified) member is eligible exactly like a verified one", () => {
    expect(isEligible(member({}), "2026-2027")).toBe(true);
  });

  it("eligibility depends only on the reported flags and the season", () => {
    expect(isEligible(member({ duesPaidReported: false }), "2026-2027")).toBe(false);
    expect(isEligible(member({ nationalMemberReported: null }), "2026-2027")).toBe(false);
    expect(isEligible(member({ membershipSeason: "2025-2026" }), "2026-2027")).toBe(false);
  });

  it("every claim state maps to a label", () => {
    const states: ClaimState[] = ["none", "pending", "verified", "revoked"];
    for (const s of states) expect(CLAIM_STATE_LABEL[s]).toBeTruthy();
  });
});

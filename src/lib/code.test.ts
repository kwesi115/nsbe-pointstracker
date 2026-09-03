/**
 * Pure unit tests for the rotating check-in code — no database, no clock
 * mocking beyond passing explicit `now` values. CODE_SECRET comes from the
 * root .env (loaded by vitest.setup.ts's dotenv/config) — these tests only
 * ever compare codes against each other or against currentCode's own output,
 * never a hardcoded digit string, so they don't depend on its actual value.
 */

import { describe, expect, it } from "vitest";
import { currentCode, msUntilRotation, verifyCode } from "./code";

const MINUTE = 60_000;
// An arbitrary minute boundary far from any DST/epoch edge case.
const BOUNDARY = 1_700_000_000_000 - (1_700_000_000_000 % MINUTE);

describe("currentCode", () => {
  it("is always exactly 6 digits", () => {
    const code = currentCode("event-1", new Date(BOUNDARY));
    expect(code).toMatch(/^\d{6}$/);
  });

  it("changes at the minute boundary", () => {
    const before = currentCode("event-1", new Date(BOUNDARY - 1));
    const after = currentCode("event-1", new Date(BOUNDARY));
    expect(after).not.toBe(before);
  });

  it("is stable within the same 60-second step", () => {
    const start = currentCode("event-1", new Date(BOUNDARY));
    const end = currentCode("event-1", new Date(BOUNDARY + MINUTE - 1));
    expect(end).toBe(start);
  });

  it("differs between two different events at the same instant", () => {
    const now = new Date(BOUNDARY);
    expect(currentCode("event-1", now)).not.toBe(currentCode("event-2", now));
    // (Extremely unlikely to collide, but not impossible with a 6-digit
    // space — this just documents the intent, not a hard guarantee.)
  });
});

describe("msUntilRotation", () => {
  it("is exactly the rotation period right at a boundary", () => {
    expect(msUntilRotation(new Date(BOUNDARY))).toBe(MINUTE);
  });

  it("counts down toward the next boundary", () => {
    expect(msUntilRotation(new Date(BOUNDARY + MINUTE - 1))).toBe(1);
  });
});

describe("verifyCode", () => {
  it("accepts the current step's code", () => {
    const now = new Date(BOUNDARY + 100);
    const code = currentCode("event-1", now);
    expect(verifyCode("event-1", code, now)).toBe(true);
  });

  it("accepts the previous step's code — someone who started typing right before rotation", () => {
    const justBefore = new Date(BOUNDARY - 100);
    const code = currentCode("event-1", justBefore);
    const justAfter = new Date(BOUNDARY + 2_000);
    expect(verifyCode("event-1", code, justAfter)).toBe(true);
  });

  it("rejects the step before the previous one", () => {
    const twoStepsAgo = new Date(BOUNDARY - MINUTE - 100);
    const code = currentCode("event-1", twoStepsAgo);
    const now = new Date(BOUNDARY + 2_000);
    expect(verifyCode("event-1", code, now)).toBe(false);
  });

  it("rejects a code from a different event", () => {
    const now = new Date(BOUNDARY + 100);
    const codeForOtherEvent = currentCode("event-2", now);
    expect(verifyCode("event-1", codeForOtherEvent, now)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const now = new Date(BOUNDARY);
    expect(verifyCode("event-1", "12x456", now)).toBe(false);
    expect(verifyCode("event-1", "12345", now)).toBe(false);
    expect(verifyCode("event-1", "1234567", now)).toBe(false);
    expect(verifyCode("event-1", "", now)).toBe(false);
  });
});

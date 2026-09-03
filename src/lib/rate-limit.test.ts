import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppError as AppErrorType } from "./errors";

// Fresh module instances per test — the rate limiter's Maps are module-level
// state, and AppError must come from the SAME reset registry so `instanceof`
// checks against it are meaningful (a stale top-level import would be a
// different class object after vi.resetModules()).
async function freshRateLimit() {
  vi.resetModules();
  const [rateLimit, errors] = await Promise.all([import("./rate-limit"), import("./errors")]);
  return { ...rateLimit, AppError: errors.AppError };
}

describe("assertNotRateLimited / recordFailedAttempt", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows 5 failed attempts and blocks the 6th, in the same window", async () => {
    const { assertNotRateLimited, recordFailedAttempt, AppError } = await freshRateLimit();
    const now = 1_000_000;
    const email = "member@bison.howard.edu";
    const ip = "10.0.0.1";

    for (let i = 0; i < 5; i++) {
      expect(() => assertNotRateLimited(email, ip, now)).not.toThrow();
      recordFailedAttempt(email, ip, now);
    }

    expect(() => assertNotRateLimited(email, ip, now)).toThrow(AppError);
    try {
      assertNotRateLimited(email, ip, now);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const appErr = err as AppErrorType;
      expect(appErr.code).toBe("TOO_MANY_ATTEMPTS");
      expect(appErr.status).toBe(429);
      expect(appErr.message).toMatch(/minute/);
    }
  });

  it("a successful login clears the email counter", async () => {
    const { assertNotRateLimited, recordFailedAttempt, clearRateLimit, AppError } = await freshRateLimit();
    const now = 1_000_000;
    const email = "member@bison.howard.edu";
    const ip = "10.0.0.2";

    for (let i = 0; i < 5; i++) recordFailedAttempt(email, ip, now);
    expect(() => assertNotRateLimited(email, ip, now)).toThrow(AppError);

    clearRateLimit(email);

    expect(() => assertNotRateLimited(email, ip, now)).not.toThrow();
  });

  it("clearing the email counter does not clear the IP counter", async () => {
    const { assertNotRateLimited, recordFailedAttempt, clearRateLimit, AppError } = await freshRateLimit();
    const now = 1_000_000;
    const ip = "10.0.0.3";

    // 20 failed attempts against the IP, spread across different emails.
    for (let i = 0; i < 20; i++) {
      recordFailedAttempt(`member${i}@bison.howard.edu`, ip, now);
    }
    clearRateLimit("member0@bison.howard.edu");

    expect(() => assertNotRateLimited("someone-new@bison.howard.edu", ip, now)).toThrow(AppError);
  });

  it("the window expires and attempts are allowed again", async () => {
    const { assertNotRateLimited, recordFailedAttempt, WINDOW_MS } = await freshRateLimit();
    const start = 1_000_000;
    const email = "member@bison.howard.edu";
    const ip = "10.0.0.4";

    for (let i = 0; i < 5; i++) recordFailedAttempt(email, ip, start);
    expect(() => assertNotRateLimited(email, ip, start)).toThrow(/too many/i);

    const afterWindow = start + WINDOW_MS + 1;
    expect(() => assertNotRateLimited(email, ip, afterWindow)).not.toThrow();
  });
});

describe("assertNotSignupRateLimited / recordSignupAttempt — 3 accounts per IP per hour", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows 3 signups and blocks the 4th, in the same window", async () => {
    const { assertNotSignupRateLimited, recordSignupAttempt, AppError } = await freshRateLimit();
    const now = 1_000_000;
    const ip = "10.1.0.1";

    for (let i = 0; i < 3; i++) {
      expect(() => assertNotSignupRateLimited(ip, now)).not.toThrow();
      recordSignupAttempt(ip, now);
    }

    expect(() => assertNotSignupRateLimited(ip, now)).toThrow(AppError);
  });
});

describe("assertNotCodeVerifyRateLimited / recordCodeVerifyAttempt — 10 attempts per member per event per 10 minutes", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("allows 10 attempts and blocks the 11th, in the same window", async () => {
    const { assertNotCodeVerifyRateLimited, recordCodeVerifyAttempt, AppError } = await freshRateLimit();
    const now = 1_000_000;
    const userId = "user-1";
    const eventId = "event-1";

    for (let i = 0; i < 10; i++) {
      expect(() => assertNotCodeVerifyRateLimited(userId, eventId, now)).not.toThrow();
      recordCodeVerifyAttempt(userId, eventId, now);
    }

    expect(() => assertNotCodeVerifyRateLimited(userId, eventId, now)).toThrow(AppError);
    try {
      assertNotCodeVerifyRateLimited(userId, eventId, now);
      expect.unreachable("should have thrown");
    } catch (err) {
      const appErr = err as AppErrorType;
      expect(appErr.code).toBe("TOO_MANY_ATTEMPTS");
      expect(appErr.status).toBe(429);
    }
  });

  it("is scoped per event — 10 attempts against one event don't block attempts against another", async () => {
    const { assertNotCodeVerifyRateLimited, recordCodeVerifyAttempt } = await freshRateLimit();
    const now = 1_000_000;
    const userId = "user-1";

    for (let i = 0; i < 10; i++) recordCodeVerifyAttempt(userId, "event-1", now);
    expect(() => assertNotCodeVerifyRateLimited(userId, "event-1", now)).toThrow();

    expect(() => assertNotCodeVerifyRateLimited(userId, "event-2", now)).not.toThrow();
  });

  it("the window expires and attempts are allowed again", async () => {
    const { assertNotCodeVerifyRateLimited, recordCodeVerifyAttempt, CODE_VERIFY_WINDOW_MS } = await freshRateLimit();
    const start = 1_000_000;
    const userId = "user-1";
    const eventId = "event-1";

    for (let i = 0; i < 10; i++) recordCodeVerifyAttempt(userId, eventId, start);
    expect(() => assertNotCodeVerifyRateLimited(userId, eventId, start)).toThrow();

    const afterWindow = start + CODE_VERIFY_WINDOW_MS + 1;
    expect(() => assertNotCodeVerifyRateLimited(userId, eventId, afterWindow)).not.toThrow();
  });
});

describe("recordEventCodeFailure / isEventCodeLocked — per-event brute-force lock", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("crosses soft at exactly the soft limit and reports it only once", async () => {
    const { recordEventCodeFailure } = await freshRateLimit();
    const now = 1_000_000;
    const eventId = "event-1";

    let sawSoft = 0;
    for (let i = 0; i < 100; i++) {
      const result = recordEventCodeFailure(eventId, 100, 250, now);
      if (result.crossedSoft) sawSoft++;
    }
    expect(sawSoft).toBe(1);
  });

  it("locks the event once hard is crossed, and stays locked until the lock expires", async () => {
    const { recordEventCodeFailure, isEventCodeLocked, EVENT_CODE_LOCK_MS } = await freshRateLimit();
    const now = 1_000_000;
    const eventId = "event-1";

    let crossedHardAt = -1;
    for (let i = 0; i < 251; i++) {
      const result = recordEventCodeFailure(eventId, 100, 250, now);
      if (result.crossedHard) crossedHardAt = i;
    }
    // The 251st failure (index 250) is the one that reaches count 251, crossing hard (>= 250).
    expect(crossedHardAt).toBe(249);
    expect(isEventCodeLocked(eventId, now)).toBe(true);
    expect(isEventCodeLocked(eventId, now + EVENT_CODE_LOCK_MS - 1)).toBe(true);
    expect(isEventCodeLocked(eventId, now + EVENT_CODE_LOCK_MS + 1)).toBe(false);
  });

  it("is scoped per event — failures against one event don't lock another", async () => {
    const { recordEventCodeFailure, isEventCodeLocked } = await freshRateLimit();
    const now = 1_000_000;

    for (let i = 0; i < 250; i++) recordEventCodeFailure("event-1", 100, 250, now);
    expect(isEventCodeLocked("event-1", now)).toBe(true);
    expect(isEventCodeLocked("event-2", now)).toBe(false);
  });

  it("clearEventCodeLock lifts the lock immediately and resets the counter", async () => {
    const { recordEventCodeFailure, isEventCodeLocked, clearEventCodeLock, getEventCodeAlertState } = await freshRateLimit();
    const now = 1_000_000;
    const eventId = "event-1";

    for (let i = 0; i < 250; i++) recordEventCodeFailure(eventId, 100, 250, now);
    expect(isEventCodeLocked(eventId, now)).toBe(true);

    clearEventCodeLock(eventId);

    expect(isEventCodeLocked(eventId, now)).toBe(false);
    expect(getEventCodeAlertState(eventId, now).suspicious).toBe(false);
  });

  it("getEventCodeAlertState reports suspicious once soft is crossed, and locked+lockedUntil once hard is crossed", async () => {
    const { recordEventCodeFailure, getEventCodeAlertState, EVENT_CODE_LOCK_MS } = await freshRateLimit();
    const now = 1_000_000;
    const eventId = "event-1";

    for (let i = 0; i < 100; i++) recordEventCodeFailure(eventId, 100, 250, now);
    let state = getEventCodeAlertState(eventId, now);
    expect(state.suspicious).toBe(true);
    expect(state.locked).toBe(false);

    for (let i = 0; i < 150; i++) recordEventCodeFailure(eventId, 100, 250, now);
    state = getEventCodeAlertState(eventId, now);
    expect(state.suspicious).toBe(true);
    expect(state.locked).toBe(true);
    expect(state.lockedUntil).toBe(now + EVENT_CODE_LOCK_MS);
  });
});

describe("hashIp", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("CODE_SECRET", "test-secret");
  });

  it("is deterministic for the same IP and different for different IPs, and never returns the raw IP", async () => {
    const { hashIp } = await freshRateLimit();
    const a = hashIp("10.0.0.1");
    const b = hashIp("10.0.0.1");
    const c = hashIp("10.0.0.2");

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toContain("10.0.0.1");
    expect(a).toHaveLength(12);
  });
});

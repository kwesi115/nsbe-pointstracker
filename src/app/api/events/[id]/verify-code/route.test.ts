/**
 * Route-handler test — POST is a plain exported async function, so it can be
 * called directly with a constructed Request/ctx, no dev server needed.
 * @/lib/session and @/lib/repo are mocked; @/lib/code and @/lib/rate-limit
 * run for real (the whole point of this route is wiring those two together
 * correctly). Each test uses its own eventId so the real rate-limit Map
 * (module-level, shared for this file's lifetime) can't leak between tests.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/repo", () => ({
  getEvent: vi.fn(),
  getUserId: vi.fn(),
  // Real defaults for the per-event limiter — these two are DB-backed in
  // production (Config read, AdminLog write) but this test only exercises
  // the real @/lib/code + @/lib/rate-limit wiring, so they're stubbed here.
  // Key-aware so soft (100) and hard (250) stay distinct, matching the real
  // prisma/seed.ts defaults.
  getConfigValue: vi.fn((_orgId: string, key: string) => Promise.resolve(key === "EVENT_CODE_FAIL_HARD" ? "250" : "100")),
  logSystemAdminEvent: vi.fn().mockResolvedValue(undefined),
}));

import { currentCode } from "@/lib/code";
import { getConfigValue, getEvent, getUserId, logSystemAdminEvent } from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { POST } from "./route";

const requireSessionMock = requireSession as unknown as ReturnType<typeof vi.fn>;
const getEventMock = getEvent as unknown as ReturnType<typeof vi.fn>;
const getUserIdMock = getUserId as unknown as ReturnType<typeof vi.fn>;
const getConfigValueMock = getConfigValue as unknown as ReturnType<typeof vi.fn>;
const logSystemAdminEventMock = logSystemAdminEvent as unknown as ReturnType<typeof vi.fn>;

const SESSION = { user: { orgId: "org-1", email: "member@bison.howard.edu" } };

function postCode(eventId: string, code: string) {
  return POST(
    new Request(`http://test/api/events/${eventId}/verify-code`, {
      method: "POST",
      body: JSON.stringify({ code }),
    }),
    { params: Promise.resolve({ id: eventId }) },
  );
}

function openEvent(eventId: string) {
  const now = Date.now();
  return { eventId, status: "scheduled", opensAt: new Date(now - 60_000), closesAt: new Date(now + 60_000) };
}

function closedEvent(eventId: string) {
  const now = Date.now();
  return { eventId, status: "scheduled", opensAt: new Date(now - 120_000), closesAt: new Date(now - 60_000) };
}

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue(SESSION);
  getEventMock.mockReset();
  getUserIdMock.mockReset().mockResolvedValue("user-1");
  getConfigValueMock.mockClear();
  logSystemAdminEventMock.mockClear();
});

describe("POST /api/events/[id]/verify-code", () => {
  it("accepts the current code", async () => {
    const eventId = "verify-ok";
    getEventMock.mockResolvedValue(openEvent(eventId));

    const res = await postCode(eventId, currentCode(eventId, new Date()));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects a wrong code with BAD_CODE", async () => {
    const eventId = "verify-wrong";
    getEventMock.mockResolvedValue(openEvent(eventId));

    const res = await postCode(eventId, "000000");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("BAD_CODE");
  });

  it("returns EVENT_NOT_OPEN — not BAD_CODE — for a closed event, even with the code that WOULD be correct if it were open", async () => {
    const eventId = "verify-closed";
    getEventMock.mockResolvedValue(closedEvent(eventId));

    const res = await postCode(eventId, currentCode(eventId, new Date()));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("EVENT_NOT_OPEN");
    expect(body.code).not.toBe("BAD_CODE");
  });

  it("11 failed attempts in the same 10-minute window are rate limited", async () => {
    const eventId = "verify-rate-limited";
    getEventMock.mockResolvedValue(openEvent(eventId));

    for (let i = 0; i < 10; i++) {
      const res = await postCode(eventId, "000000");
      expect(res.status).toBe(403); // BAD_CODE, not yet rate limited
    }

    const eleventh = await postCode(eventId, "000000");
    expect(eleventh.status).toBe(429);
    expect((await eleventh.json()).code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("a successful verification never increments the per-member limiter — 20 good codes in a row are never rate limited", async () => {
    const eventId = "verify-success-not-limited";
    getEventMock.mockResolvedValue(openEvent(eventId));

    for (let i = 0; i < 20; i++) {
      const res = await postCode(eventId, currentCode(eventId, new Date()));
      expect(res.status).toBe(200);
    }
  });

  it("251 failed check-in code attempts on one event within 10 minutes trigger the hard lock — a subsequent attempt (even from a fresh, never-before-seen member) gets the paused message, not BAD_CODE", async () => {
    const eventId = "verify-hard-lock";
    getEventMock.mockResolvedValue(openEvent(eventId));

    // 251 failures spread across 26 distinct members (10 each — one under
    // that member's own 10-per-event limiter) so the per-MEMBER limiter
    // never fires; only the per-EVENT one (member/IP-agnostic) should.
    let total = 0;
    for (let member = 0; total < 251; member++) {
      getUserIdMock.mockResolvedValue(`user-${member}`);
      for (let attempt = 0; attempt < 10 && total < 251; attempt++) {
        const res = await postCode(eventId, "000000");
        total++;
        expect(res.status).toBe(403);
      }
    }
    expect(total).toBe(251);
    // One AdminLog "suspected" entry from crossing soft (100) — never one per attempt.
    expect(logSystemAdminEventMock).toHaveBeenCalledTimes(1);
    expect(logSystemAdminEventMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ action: "code_brute_force_suspected", target: eventId }),
    );

    // A brand-new member, not rate-limited themselves, still gets rejected —
    // by the lock, not by guessing wrong — and can't tell the difference
    // between "closed" and "locked".
    getUserIdMock.mockResolvedValue("user-fresh-never-attempted");
    const locked = await postCode(eventId, currentCode(eventId, new Date())); // even the CORRECT code
    expect(locked.status).toBe(403);
    const body = await locked.json();
    expect(body.code).toBe("EVENT_NOT_OPEN");
    expect(body.code).not.toBe("BAD_CODE");
    expect(body.message).toMatch(/paused/i);
  });
});

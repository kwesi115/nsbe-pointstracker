/**
 * Focused test for clearEventCodeLockAction — the admin escape hatch for the
 * per-event check-in code brute-force lock (see lib/rate-limit.ts). Real
 * @/lib/rate-limit runs for real (the point of this test is confirming the
 * lock actually lifts); @/lib/session, @/lib/repo, and next/cache are mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireEboard: vi.fn() }));
vi.mock("@/lib/repo", () => ({ logSystemAdminEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { isEventCodeLocked, recordEventCodeFailure } from "@/lib/rate-limit";
import { logSystemAdminEvent } from "@/lib/repo";
import { requireEboard } from "@/lib/session";
import { clearEventCodeLockAction } from "./actions";

const requireEboardMock = requireEboard as unknown as ReturnType<typeof vi.fn>;
const logSystemAdminEventMock = logSystemAdminEvent as unknown as ReturnType<typeof vi.fn>;

const SESSION = { user: { orgId: "org-1", email: "eboard@bison.howard.edu", role: "eboard" } };

beforeEach(() => {
  requireEboardMock.mockReset().mockResolvedValue(SESSION);
  logSystemAdminEventMock.mockClear();
});

describe("clearEventCodeLockAction", () => {
  it("requires EBOARD (or ADMIN) — an unauthenticated/non-eboard caller never reaches the lock", async () => {
    requireEboardMock.mockRejectedValueOnce(new Error("forbidden"));
    await expect(clearEventCodeLockAction("event-1")).rejects.toThrow();
  });

  it("an eboard/admin caller clears an active lock immediately", async () => {
    const eventId = "event-locked";
    const now = 1_000_000;
    for (let i = 0; i < 250; i++) recordEventCodeFailure(eventId, 100, 250, now);
    expect(isEventCodeLocked(eventId, now)).toBe(true);

    const result = await clearEventCodeLockAction(eventId);

    expect(result.error).toBeNull();
    expect(isEventCodeLocked(eventId, now)).toBe(false);
    expect(logSystemAdminEventMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ actor: "eboard@bison.howard.edu", action: "code_brute_force_lock_cleared", target: eventId }),
    );
  });
});

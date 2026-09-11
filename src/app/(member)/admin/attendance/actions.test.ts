/**
 * The attendance directory's write path.
 *
 * The permission split is the headline: reading the directory is E-Board
 * access, but adding, removing, or re-pointing a registration all award or
 * withdraw points after the check-in window shut, so they require
 * attendance_write — which an E-Board officer does NOT hold by role (see
 * lib/access.ts PERMISSION_ROLES). These tests run the REAL permissions
 * engine over a mocked session and grant list, so "ATTENDANCE:READ but not
 * WRITE" is exercised as an actual state rather than asserted in a comment.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@/lib/types";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn(), requireEboard: vi.fn() }));
vi.mock("@/lib/repo", () => ({
  hasPermission: vi.fn(),
  addManualAttendanceBulk: vi.fn(),
  getAddableMembers: vi.fn(),
  getEventAttendees: vi.fn(),
  previewManualAttendance: vi.fn(),
  previewRemoveRegistration: vi.fn(),
  removeRegistration: vi.fn(),
  updateRegistrationPoints: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import {
  addManualAttendanceBulk,
  hasPermission,
  previewManualAttendance,
  removeRegistration,
  updateRegistrationPoints,
} from "@/lib/repo";
import { requireEboard, requireSession } from "@/lib/session";
import {
  addAttendeesAction,
  previewAddAttendeesAction,
  removeRegistrationAction,
  updateRegistrationPointsAction,
} from "./actions";

const requireSessionMock = requireSession as unknown as ReturnType<typeof vi.fn>;
const requireEboardMock = requireEboard as unknown as ReturnType<typeof vi.fn>;
const hasPermissionMock = hasPermission as unknown as ReturnType<typeof vi.fn>;
const addBulkMock = addManualAttendanceBulk as unknown as ReturnType<typeof vi.fn>;
const previewMock = previewManualAttendance as unknown as ReturnType<typeof vi.fn>;
const removeMock = removeRegistration as unknown as ReturnType<typeof vi.fn>;
const updatePointsMock = updateRegistrationPoints as unknown as ReturnType<typeof vi.fn>;

function signedInAs(role: Role, grants: string[] = []) {
  const session = {
    user: { email: "officer@bison.howard.edu", orgId: "org-1", role, mustChangePassword: false, status: "active" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  };
  requireSessionMock.mockResolvedValue(session);
  requireEboardMock.mockResolvedValue(session);
  hasPermissionMock.mockImplementation(async (_org: string, _email: string, p: string) => grants.includes(p));
}

// The three mutating actions take `(prevState, formData)` now — they are
// dispatched by a form submit (see components/ui/ConfirmDialog.tsx), which is
// what gives React a transition to own. These wrappers keep the tests reading
// as "add these two people with this note" rather than as FormData plumbing.
function callAdd(eventId: string, emails: string[], note: string) {
  const fd = new FormData();
  fd.set("eventId", eventId);
  for (const email of emails) fd.append("emails", email);
  fd.set("reason", note);
  return addAttendeesAction({ error: null, result: null }, fd);
}

function callRemove(registrationId: string, reason: string) {
  const fd = new FormData();
  fd.set("registrationId", registrationId);
  fd.set("reason", reason);
  return removeRegistrationAction({ error: null }, fd);
}

function callUpdatePoints(registrationId: string, points: number, reason: string) {
  const fd = new FormData();
  fd.set("registrationId", registrationId);
  fd.set("points", String(points));
  fd.set("reason", reason);
  return updateRegistrationPointsAction({ error: null, points: null }, fd);
}

const OK_BULK = { added: ["ada@bison.howard.edu"], alreadyRegistered: [], notFound: [], totalPoints: 3 };

beforeEach(() => {
  for (const m of [
    requireSessionMock,
    requireEboardMock,
    hasPermissionMock,
    addBulkMock,
    previewMock,
    removeMock,
    updatePointsMock,
  ]) {
    m.mockReset();
  }
  addBulkMock.mockResolvedValue(OK_BULK);
  removeMock.mockResolvedValue(undefined);
  updatePointsMock.mockResolvedValue(undefined);
});

describe("ATTENDANCE:READ but not WRITE", () => {
  // The case the permission exists for: an officer can open the directory,
  // and cannot change what it says.
  it("an EBOARD officer without the grant cannot add attendees", async () => {
    signedInAs("eboard");
    const { error } = await callAdd("event-1", ["ada@bison.howard.edu"], "Phone died");

    expect(error).toMatch(/Attendance editing permission/i);
    expect(addBulkMock).not.toHaveBeenCalled();
  });

  it("an EBOARD officer without the grant cannot remove a registration", async () => {
    signedInAs("eboard");
    const { error } = await callRemove("reg-1", "Logged twice");

    expect(error).toMatch(/Attendance editing permission/i);
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("an EBOARD officer without the grant cannot re-point a registration", async () => {
    signedInAs("eboard");
    const { error } = await callUpdatePoints("reg-1", 5, "Wrong category");

    expect(error).toMatch(/Attendance editing permission/i);
    expect(updatePointsMock).not.toHaveBeenCalled();
  });

  it("the same officer WITH the grant can add", async () => {
    signedInAs("eboard", ["attendance_write"]);
    const { error, result } = await callAdd("event-1", ["ada@bison.howard.edu"], "Phone died");

    expect(error).toBeNull();
    expect(result).toEqual(OK_BULK);
  });

  it("an ADMIN holds it outright, with no grant", async () => {
    signedInAs("admin");
    const { error } = await callAdd("event-1", ["ada@bison.howard.edu"], "Arrived late");

    expect(error).toBeNull();
    expect(addBulkMock).toHaveBeenCalled();
  });

  it("a GENERAL member is refused even with the verifications grant — the grants are not interchangeable", async () => {
    signedInAs("general", ["verifications_write"]);
    const { error } = await callAdd("event-1", ["ada@bison.howard.edu"], "Note");

    expect(error).toMatch(/Attendance editing permission/i);
    expect(addBulkMock).not.toHaveBeenCalled();
  });
});

describe("adding attendees", () => {
  beforeEach(() => signedInAs("admin"));

  it("passes the note through to the writer", async () => {
    await callAdd("event-1", ["ada@bison.howard.edu", "grace@bison.howard.edu"], "Checked in on paper");

    expect(addBulkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        eventId: "event-1",
        emails: ["ada@bison.howard.edu", "grace@bison.howard.edu"],
        note: "Checked in on paper",
        addedBy: "officer@bison.howard.edu",
      }),
    );
  });

  it("surfaces the writer's refusal of an empty note rather than swallowing it", async () => {
    const { AppError } = await import("@/lib/errors");
    addBulkMock.mockRejectedValue(
      new AppError("VALIDATION_FAILED", "A note is required — say why this member is being added."),
    );

    const { error, result } = await callAdd("event-1", ["ada@bison.howard.edu"], "   ");
    expect(error).toMatch(/note is required/i);
    expect(result).toBeNull();
  });

  it("reports members who were already registered instead of failing the whole batch", async () => {
    addBulkMock.mockResolvedValue({
      added: ["ada@bison.howard.edu"],
      alreadyRegistered: ["grace@bison.howard.edu"],
      notFound: [],
      totalPoints: 3,
    });

    const { result } = await callAdd(
      "event-1",
      ["ada@bison.howard.edu", "grace@bison.howard.edu"],
      "After the meeting",
    );

    expect(result?.added).toEqual(["ada@bison.howard.edu"]);
    expect(result?.alreadyRegistered).toEqual(["grace@bison.howard.edu"]);
  });
});

describe("the preview an officer sees before confirming", () => {
  beforeEach(() => signedInAs("admin"));

  it("reports the NSBE Week bonus moving and the month still being open", async () => {
    previewMock.mockResolvedValue({
      eventName: "NSBE Week — Panel",
      eventClosed: true,
      members: [
        {
          email: "ada@bison.howard.edu",
          name: "Ada Lovelace",
          role: "general",
          points: 3,
          zeroByRole: false,
          groupBonusChange: { groupName: "NSBE Week", from: 0, to: 5 },
        },
      ],
      totalPoints: 3,
      monthlyChampionMonth: "2026-09",
      monthlyChampionStillOpen: true,
    });

    const { preview } = await previewAddAttendeesAction("event-1", ["ada@bison.howard.edu"]);

    expect(preview?.members[0].groupBonusChange).toEqual({ groupName: "NSBE Week", from: 0, to: 5 });
    expect(preview?.monthlyChampionStillOpen).toBe(true);
    expect(preview?.eventClosed).toBe(true);
  });

  it("is gated on write access too — it is a preview of a points-granting action", async () => {
    signedInAs("eboard");
    const { preview, error } = await previewAddAttendeesAction("event-1", ["ada@bison.howard.edu"]);

    expect(preview).toBeNull();
    expect(error).toMatch(/Attendance editing permission/i);
  });
});

describe("removing and re-pointing", () => {
  beforeEach(() => signedInAs("admin"));

  it("forwards the reason to the writer, which logs it", async () => {
    await callRemove("reg-1", "Logged twice");
    expect(removeMock).toHaveBeenCalledWith("org-1", "reg-1", "Logged twice", "officer@bison.howard.edu");
  });

  it("forwards the new point value and the reason", async () => {
    await callUpdatePoints("reg-1", 5, "Category value was wrong");
    expect(updatePointsMock).toHaveBeenCalledWith(
      "org-1",
      "reg-1",
      5,
      "Category value was wrong",
      "officer@bison.howard.edu",
    );
  });

  it("surfaces the writer's refusal of a blank reason", async () => {
    const { AppError } = await import("@/lib/errors");
    removeMock.mockRejectedValue(new AppError("VALIDATION_FAILED", "A reason is required to remove a registration."));

    const { error } = await callRemove("reg-1", "");
    expect(error).toMatch(/reason is required/i);
  });
});

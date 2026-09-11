/**
 * Editing a t-shirt size from the two surfaces that can now do it: the member
 * themselves at /account, and an admin at /admin/members/[id].
 *
 * Both go through lib/repo.ts updateProfileFields, which is the shared mutator
 * that writes an "update_profile" AdminLog row unconditionally — so what these
 * tests pin down is that each surface reaches that mutator with the right
 * target and the right ACTOR. A member's own edit is attributed to them; an
 * admin's edit to the admin. (The AdminLog write itself is exercised against
 * Postgres in lib/repo.test.ts.)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireSession: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/repo", () => ({
  updateProfileFields: vi.fn().mockResolvedValue({}),
  changePassword: vi.fn(),
  clearHouseAssignment: vi.fn(),
  removeResume: vi.fn(),
  setDuesReported: vi.fn(),
  setHouseAssignment: vi.fn(),
  setNationalReported: vi.fn(),
  setResume: vi.fn(),
  getMember: vi.fn(),
  grantPermission: vi.fn(),
  revokePermission: vi.fn(),
  setMemberRole: vi.fn(),
  setMemberStatus: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { updateProfileFields } from "@/lib/repo";
import { requireAdmin, requireSession } from "@/lib/session";
import { updateProfileAction } from "./actions";
import { adminUpdateProfileAction } from "../admin/members/actions";

const updateProfileFieldsMock = updateProfileFields as unknown as ReturnType<typeof vi.fn>;
const requireSessionMock = requireSession as unknown as ReturnType<typeof vi.fn>;
const requireAdminMock = requireAdmin as unknown as ReturnType<typeof vi.fn>;

const MEMBER = { user: { orgId: "org-1", email: "ada@bison.howard.edu", role: "general" } };
const ADMIN = { user: { orgId: "org-1", email: "admin@bison.howard.edu", role: "admin" } };

/** The whole form is submitted on every save, so a realistic payload includes the untouched fields too. */
const BASE = {
  firstName: "Ada",
  lastName: "Lovelace",
  studentId: "1000001",
  phone: "555-0100",
  personalEmail: "ada@example.com",
  major: "Computer Engineering",
  majorOther: "",
};

beforeEach(() => {
  updateProfileFieldsMock.mockClear().mockResolvedValue({});
  requireSessionMock.mockReset().mockResolvedValue(MEMBER);
  requireAdminMock.mockReset().mockResolvedValue(ADMIN);
});

describe("a member changing their own t-shirt size", () => {
  it("saves the new size against their own account", async () => {
    const result = await updateProfileAction({ ...BASE, tshirtSize: "L" });

    expect(result.error).toBeNull();
    expect(updateProfileFieldsMock).toHaveBeenCalledWith(
      "org-1",
      "ada@bison.howard.edu",
      expect.objectContaining({ tshirtSize: "L" }),
      "ada@bison.howard.edu",
    );
  });

  it("can move between any two of the seven sizes", async () => {
    for (const size of ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const) {
      updateProfileFieldsMock.mockClear();
      await updateProfileAction({ ...BASE, tshirtSize: size });
      expect(updateProfileFieldsMock.mock.calls[0][2]).toMatchObject({ tshirtSize: size });
    }
  });

  it("still refuses the save when a required contact field is blank", async () => {
    const result = await updateProfileAction({ ...BASE, phone: "", tshirtSize: "M" });

    expect(result.error).toBe("Phone is required.");
    expect(updateProfileFieldsMock).not.toHaveBeenCalled();
  });

  it("leaves the size untouched when the form omits it, rather than blanking it", async () => {
    await updateProfileAction({ ...BASE });
    expect(updateProfileFieldsMock.mock.calls[0][2]).not.toHaveProperty("tshirtSize");
  });
});

describe("an admin changing a member's t-shirt size", () => {
  it("saves it against the member, attributed to the admin", async () => {
    const result = await adminUpdateProfileAction("ada@bison.howard.edu", { ...BASE, tshirtSize: "XXL" });

    expect(result.error).toBeNull();
    expect(updateProfileFieldsMock).toHaveBeenCalledWith(
      "org-1",
      "ada@bison.howard.edu",
      expect.objectContaining({ tshirtSize: "XXL" }),
      // The actor is the admin, not the member — that is what makes the
      // resulting AdminLog row meaningful.
      "admin@bison.howard.edu",
    );
  });

  it("requires an ADMIN", async () => {
    requireAdminMock.mockRejectedValue(new Error("FORBIDDEN"));
    await expect(adminUpdateProfileAction("ada@bison.howard.edu", { tshirtSize: "M" })).rejects.toThrow();
    expect(updateProfileFieldsMock).not.toHaveBeenCalled();
  });

  it("normalizes the target email before writing", async () => {
    await adminUpdateProfileAction("  Ada@Bison.Howard.Edu ", { tshirtSize: "S" });
    expect(updateProfileFieldsMock.mock.calls[0][1]).toBe("ada@bison.howard.edu");
  });
});

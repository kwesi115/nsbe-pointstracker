/**
 * The guard layer — the session, roster, and feature-flag reads wired into
 * lib/access.ts's pure policy. requireSession/getRole/getActivePermissions/
 * isFeatureEnabled are all mocked (same pattern as lib/permissions.test.ts);
 * the policy itself runs for real, since that is the thing being composed.
 *
 * The headline case: guardAdminPage RETURNS a denial rather than throwing one.
 * That is what lets an admin page render <AccessDenied> with the specific copy
 * intact — a thrown error loses its message and every custom property on the
 * way to a Server Component error boundary in production.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { PermissionName, Role } from "./types";

vi.mock("./session", () => ({ requireSession: vi.fn() }));
vi.mock("./repo", () => ({ getRole: vi.fn(), getActivePermissions: vi.fn() }));
vi.mock("./features", () => ({ isFeatureEnabled: vi.fn() }));

import { isFeatureEnabled } from "./features";
import { getActivePermissions, getRole } from "./repo";
import { requireSession } from "./session";
import { guardAdminPage, requireAccess } from "./access-guards";

const requireSessionMock = requireSession as unknown as ReturnType<typeof vi.fn>;
const getRoleMock = getRole as unknown as ReturnType<typeof vi.fn>;
const getActivePermissionsMock = getActivePermissions as unknown as ReturnType<typeof vi.fn>;
const isFeatureEnabledMock = isFeatureEnabled as unknown as ReturnType<typeof vi.fn>;

function signedInAs(role: Role, opts: { permissions?: PermissionName[]; exports?: boolean } = {}) {
  requireSessionMock.mockResolvedValue({
    user: { email: "officer@bison.howard.edu", orgId: "org-1", role, mustChangePassword: false, status: "active" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session);
  getRoleMock.mockResolvedValue(role);
  getActivePermissionsMock.mockResolvedValue(opts.permissions ?? []);
  isFeatureEnabledMock.mockResolvedValue(opts.exports ?? false);
}

beforeEach(() => {
  requireSessionMock.mockReset();
  getRoleMock.mockReset();
  getActivePermissionsMock.mockReset();
  isFeatureEnabledMock.mockReset();
});

describe("guardAdminPage — returns the denial, never throws it", () => {
  // The page that broke: an EBOARD officer on /admin/join-codes.
  it("gives an EBOARD officer on an ADMIN-only page a denial, not an error", async () => {
    signedInAs("eboard");
    const guard = await guardAdminPage({ level: "admin" });

    expect(guard.ok).toBe(false);
    if (guard.ok) throw new Error("expected a denial");
    expect(guard.denial).toEqual({ kind: "admin" });
    // They can still use /admin itself, so the page keeps its "Back to admin" action.
    expect(guard.canUseAdminHome).toBe(true);
  });

  it("passes an ADMIN through with the session and the loaded access", async () => {
    signedInAs("admin", { exports: true });
    const guard = await guardAdminPage({ level: "admin" });

    expect(guard.ok).toBe(true);
    if (!guard.ok) throw new Error("expected access");
    expect(guard.session.user.email).toBe("officer@bison.howard.edu");
    expect(guard.access).toEqual({ role: "admin", permissions: [], features: { exports: true } });
  });

  it("names the missing grant for a GENERAL member without it", async () => {
    signedInAs("general");
    const guard = await guardAdminPage({ level: "permission", permission: "verifications_write" });

    if (guard.ok) throw new Error("expected a denial");
    expect(guard.denial).toEqual({ kind: "permission", permission: "verifications_write" });
    // /admin is E-Board-only, so offering "Back to admin" would just deny them again.
    expect(guard.canUseAdminHome).toBe(false);
  });

  it("lets a GENERAL member with the grant through", async () => {
    signedInAs("general", { permissions: ["verifications_write"] });
    const guard = await guardAdminPage({ level: "permission", permission: "verifications_write" });
    expect(guard.ok).toBe(true);
  });

  it("re-reads the role from the roster instead of trusting the session's", async () => {
    signedInAs("admin");
    // Demoted since the JWT was minted.
    getRoleMock.mockResolvedValue("eboard");

    const guard = await guardAdminPage({ level: "admin" });
    expect(guard.ok).toBe(false);
  });
});

describe("guardAdminPage — the exports flag", () => {
  const EXPORTS = { level: "eboard", feature: "exports" } as const;

  it("denies /admin/exports to an ADMIN while the flag is off", async () => {
    signedInAs("admin", { exports: false });
    const guard = await guardAdminPage(EXPORTS);

    if (guard.ok) throw new Error("expected a denial");
    expect(guard.denial).toEqual({ kind: "feature", feature: "exports" });
  });

  it("denies it to an EBOARD officer too", async () => {
    signedInAs("eboard", { exports: false });
    expect((await guardAdminPage(EXPORTS)).ok).toBe(false);
  });

  it("restores the page as soon as the flag is turned on", async () => {
    signedInAs("eboard", { exports: true });
    expect((await guardAdminPage(EXPORTS)).ok).toBe(true);
  });
});

describe("requireAccess — the action/route-handler counterpart", () => {
  it("throws a FORBIDDEN AppError carrying the denial", async () => {
    signedInAs("eboard", { exports: false });
    await expect(requireAccess({ level: "eboard", feature: "exports" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      status: 403,
      denial: { kind: "feature", feature: "exports" },
    });
  });

  it("reports the specific missing grant in the message", async () => {
    signedInAs("general");
    await expect(requireAccess({ level: "permission", permission: "verifications_write" })).rejects.toThrow(
      "This page requires the Membership audit permission. Ask an admin to grant it.",
    );
  });

  it("returns the session when access is allowed", async () => {
    signedInAs("admin");
    await expect(requireAccess({ level: "admin" })).resolves.toMatchObject({
      user: { email: "officer@bison.howard.edu" },
    });
  });
});

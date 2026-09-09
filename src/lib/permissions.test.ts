/**
 * Unit tests for the permissions engine's guards — requireSession, hasPermission,
 * and next/navigation's forbidden() are all mocked (see lib/session.test.ts
 * for the same pattern; lib/repo.test.ts covers the real grant/revoke/
 * hasPermission behavior against Postgres).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import type { Role } from "./types";

vi.mock("./session", () => ({ requireSession: vi.fn<() => Promise<Session>>() }));
vi.mock("./repo", () => ({ hasPermission: vi.fn<() => Promise<boolean>>() }));
vi.mock("next/navigation", () => ({
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN_SENTINEL");
  }),
}));

import { requireSession } from "./session";
import { hasPermission } from "./repo";
import { requireVerificationsWrite, requireVerificationsWriteAction } from "./permissions";

function sessionFor(role: Role): Session {
  return {
    user: { email: "member@bison.howard.edu", orgId: "org-1", role, mustChangePassword: false, status: "active" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

interface SimpleAsyncMock<T> {
  mockResolvedValue(value: T): void;
  mockReset(): void;
}
const requireSessionMock = requireSession as unknown as SimpleAsyncMock<Session>;
const hasPermissionMock = hasPermission as unknown as SimpleAsyncMock<boolean>;

beforeEach(() => {
  requireSessionMock.mockReset();
  hasPermissionMock.mockReset();
});

describe("requireVerificationsWriteAction", () => {
  it.each<Role>(["admin", "eboard"])("accepts %s without ever checking a grant", async (role) => {
    requireSessionMock.mockResolvedValue(sessionFor(role));
    await expect(requireVerificationsWriteAction()).resolves.toBeTruthy();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it("accepts a GENERAL member with an active grant", async () => {
    requireSessionMock.mockResolvedValue(sessionFor("general"));
    hasPermissionMock.mockResolvedValue(true);
    await expect(requireVerificationsWriteAction()).resolves.toBeTruthy();
    expect(hasPermissionMock).toHaveBeenCalledWith("org-1", "member@bison.howard.edu", "verifications_write");
  });

  it("rejects a GENERAL member with no grant", async () => {
    requireSessionMock.mockResolvedValue(sessionFor("general"));
    hasPermissionMock.mockResolvedValue(false);
    await expect(requireVerificationsWriteAction()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a GUEST outright", async () => {
    requireSessionMock.mockResolvedValue(sessionFor("guest"));
    hasPermissionMock.mockResolvedValue(false);
    await expect(requireVerificationsWriteAction()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requireVerificationsWrite — the page guard", () => {
  it("calls next/navigation's forbidden() (real 403) for a GENERAL member with no grant", async () => {
    requireSessionMock.mockResolvedValue(sessionFor("general"));
    hasPermissionMock.mockResolvedValue(false);
    await expect(requireVerificationsWrite()).rejects.toThrow("FORBIDDEN_SENTINEL");
  });

  it("passes through for an EBOARD session", async () => {
    requireSessionMock.mockResolvedValue(sessionFor("eboard"));
    await expect(requireVerificationsWrite()).resolves.toBeTruthy();
  });
});

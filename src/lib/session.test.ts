/**
 * Unit tests for the role guards — auth() and getRole() are mocked so these
 * run without a real session or database (see repo.test.ts/joincodes.test.ts
 * for the real-Postgres integration tests). next/navigation's forbidden()
 * throws a special tagged error in the real app; here it's mocked to throw a
 * plain sentinel Error so the *Forbidden variants are distinguishable from
 * the AppError-throwing ones in assertions.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { AppError } from "./errors";
import type { Role } from "./types";

vi.mock("@/auth", () => ({ auth: vi.fn<() => Promise<Session | null>>() }));
vi.mock("./repo", () => ({ getRole: vi.fn<() => Promise<Role>>() }));
vi.mock("next/navigation", () => ({
  forbidden: vi.fn(() => {
    throw new Error("FORBIDDEN_SENTINEL");
  }),
}));

import { auth } from "@/auth";
import { getRole } from "./repo";
import { assertOrgMatch, requireAdmin, requireAdminForbidden, requireEboard, requireEboardForbidden } from "./session";

function sessionFor(email: string, orgId: string): Session {
  return {
    user: { email, orgId, role: "general", mustChangePassword: false, status: "active" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

// auth()'s real type is NextAuth's overloaded signature (it doubles as a
// middleware wrapper) — cast to the plain shape this module actually calls it
// with (no arguments) so mockResolvedValue's argument type is unambiguous.
interface SimpleAsyncMock<T> {
  mockResolvedValue(value: T): void;
  mockReset(): void;
}
const authMock = auth as unknown as SimpleAsyncMock<Session | null>;
const getRoleMock = getRole as unknown as SimpleAsyncMock<Role>;

beforeEach(() => {
  authMock.mockReset();
  getRoleMock.mockReset();
});

describe("requireAdmin — ADMIN only", () => {
  it.each<Role>(["eboard", "general", "guest"])("rejects role %s", async (role) => {
    authMock.mockResolvedValue(sessionFor("a@b.com", "org-1"));
    getRoleMock.mockResolvedValue(role);
    await expect(requireAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("accepts admin", async () => {
    authMock.mockResolvedValue(sessionFor("a@b.com", "org-1"));
    getRoleMock.mockResolvedValue("admin");
    await expect(requireAdmin()).resolves.toBeTruthy();
  });
});

describe("requireEboard — EBOARD or above", () => {
  it.each<Role>(["admin", "eboard"])("accepts %s", async (role) => {
    authMock.mockResolvedValue(sessionFor("a@b.com", "org-1"));
    getRoleMock.mockResolvedValue(role);
    await expect(requireEboard()).resolves.toBeTruthy();
  });

  it.each<Role>(["general", "guest"])("rejects %s", async (role) => {
    authMock.mockResolvedValue(sessionFor("a@b.com", "org-1"));
    getRoleMock.mockResolvedValue(role);
    await expect(requireEboard()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("/admin/join-codes guard — ADMIN only, EBOARD is not enough", () => {
  it("requireAdminForbidden calls forbidden() for an EBOARD session", async () => {
    authMock.mockResolvedValue(sessionFor("officer@b.com", "org-1"));
    getRoleMock.mockResolvedValue("eboard");
    await expect(requireAdminForbidden()).rejects.toThrow("FORBIDDEN_SENTINEL");
  });

  it("requireAdminForbidden passes through for an ADMIN session", async () => {
    authMock.mockResolvedValue(sessionFor("admin@b.com", "org-1"));
    getRoleMock.mockResolvedValue("admin");
    await expect(requireAdminForbidden()).resolves.toBeTruthy();
  });

  it("requireEboardForbidden still accepts EBOARD (the internal leaderboard's own guard)", async () => {
    authMock.mockResolvedValue(sessionFor("officer@b.com", "org-1"));
    getRoleMock.mockResolvedValue("eboard");
    await expect(requireEboardForbidden()).resolves.toBeTruthy();
  });
});

describe("assertOrgMatch — a session for org A must 403 on org B's routes", () => {
  it("throws FORBIDDEN when the session's orgId differs from the target", () => {
    const session = sessionFor("a@b.com", "org-a");
    expect(() => assertOrgMatch(session, "org-b")).toThrow(AppError);
    try {
      assertOrgMatch(session, "org-b");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("passes silently when the orgId matches", () => {
    const session = sessionFor("a@b.com", "org-a");
    expect(() => assertOrgMatch(session, "org-a")).not.toThrow();
  });
});

/**
 * Unit test for signOutAction (Part 5) — auth()/signOut()/getOrgById() and
 * the cookie store are all mocked, same pattern as lib/session.test.ts, so
 * this runs without a real session, database, or Auth.js cookie plumbing.
 * Clearing the session cookie itself is signOut()'s job, not this action's —
 * what this action owns is dropping the guest_pass and picking the org
 * landing as the destination.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: vi.fn() })),
}));
vi.mock("@/auth", () => ({
  auth: vi.fn<() => Promise<Session | null>>(),
  signOut: vi.fn(async () => undefined),
}));
vi.mock("@/lib/repo", () => ({ getOrgById: vi.fn() }));

import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { getOrgById } from "@/lib/repo";
import { signOutAction } from "./actions";

interface SimpleAsyncMock<T> {
  mockResolvedValue(value: T): void;
  mockReset(): void;
}
const authMock = auth as unknown as SimpleAsyncMock<Session | null>;
const signOutMock = signOut as unknown as ReturnType<typeof vi.fn>;
const getOrgByIdMock = getOrgById as unknown as SimpleAsyncMock<{ id: string; slug: string } | null>;
const cookiesMock = cookies as unknown as ReturnType<typeof vi.fn>;

function sessionFor(orgId: string): Session {
  return {
    user: { email: "a@b.com", orgId, role: "general", mustChangePassword: false, status: "active" },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as Session;
}

beforeEach(() => {
  authMock.mockReset();
  signOutMock.mockReset();
  getOrgByIdMock.mockReset();
});

describe("signOutAction", () => {
  it("clears the guest_pass cookie and redirects to the org landing", async () => {
    authMock.mockResolvedValue(sessionFor("org-1"));
    getOrgByIdMock.mockResolvedValue({ id: "org-1", slug: "howard-nsbe" });
    const deleteMock = vi.fn();
    cookiesMock.mockResolvedValue({ delete: deleteMock });

    await signOutAction();

    expect(deleteMock).toHaveBeenCalledWith(GUEST_PASS_COOKIE);
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/org/howard-nsbe" });
  });

  it("falls back to / when there is no session to resolve an org from", async () => {
    authMock.mockResolvedValue(null);
    const deleteMock = vi.fn();
    cookiesMock.mockResolvedValue({ delete: deleteMock });

    await signOutAction();

    expect(deleteMock).toHaveBeenCalledWith(GUEST_PASS_COOKIE);
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/" });
  });
});

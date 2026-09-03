/**
 * Unit tests for loginAction — signIn()/requireOrgContext() and the cookie
 * store are all mocked, same pattern as lib/session.test.ts, so this runs
 * without a real session, database, or Auth.js credential verification.
 * "next-auth" itself is mocked too: importing the real package here drags in
 * next-auth/lib/env.js, which resolves "next/server" in a way this
 * node-environment vitest run can't load — loginAction only needs its
 * AuthError export for an `instanceof` check in a catch branch this test
 * never exercises (signIn() is mocked to resolve, not throw).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ delete: vi.fn() })),
}));
vi.mock("@/auth", () => ({ signIn: vi.fn(async () => undefined) }));
vi.mock("@/lib/org", () => ({ requireOrgContext: vi.fn(async () => ({ orgId: "org-1" })) }));

import { cookies } from "next/headers";
import { signIn } from "@/auth";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { loginAction } from "./actions";

const signInMock = signIn as unknown as ReturnType<typeof vi.fn>;
const cookiesMock = cookies as unknown as ReturnType<typeof vi.fn>;

function formDataWith(callbackUrl: string): FormData {
  const formData = new FormData();
  formData.set("email", "a@b.com");
  formData.set("password", "hunter2");
  formData.set("callbackUrl", callbackUrl);
  return formData;
}

beforeEach(() => {
  signInMock.mockReset().mockResolvedValue(undefined);
});

describe("loginAction", () => {
  it("clears any guest_pass cookie before signing in (Part 3)", async () => {
    const deleteMock = vi.fn();
    cookiesMock.mockResolvedValue({ delete: deleteMock });

    await loginAction({ error: null }, formDataWith("/leaderboard"));

    expect(deleteMock).toHaveBeenCalledWith(GUEST_PASS_COOKIE);
  });

  it("still honors ?callbackUrl after a successful sign-in", async () => {
    cookiesMock.mockResolvedValue({ delete: vi.fn() });

    await loginAction({ error: null }, formDataWith("/leaderboard"));

    expect(signInMock).toHaveBeenCalledWith("credentials", expect.objectContaining({ redirectTo: "/leaderboard" }));
  });
});

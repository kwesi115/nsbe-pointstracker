/**
 * A member signs in with a setup code and lands on /set-password — through the
 * real authorize() and jwt() in src/auth.ts and the real src/proxy.ts.
 *
 * Auth.js, the database and next/headers are mocked. NextAuth() is replaced by
 * a stub that captures the config it is handed, so authorize() runs exactly as
 * written; the auth record it reads is what lib/repo.ts getAuthRecord returns
 * for a pending account (lib/reset-password.test.ts covers producing that row).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

process.env.AUTH_SECRET ||= "test-only-secret-for-auth-tests";
process.env.CODE_SECRET ||= "test-code-secret";

const captured = vi.hoisted(() => ({ config: null as unknown }));

vi.mock("next-auth", () => ({
  default: (config: unknown) => {
    captured.config = config;
    return { handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() };
  },
  CredentialsSignin: class CredentialsSignin extends Error {},
}));
vi.mock("next-auth/providers/credentials", () => ({ default: (options: unknown) => options }));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ delete: vi.fn() })) }));
vi.mock("@/lib/repo", () => ({
  getAuthRecord: vi.fn(),
  getMember: vi.fn(),
  getSessionUser: vi.fn(),
  isLoginEmailAllowed: vi.fn(),
}));

import { getToken } from "next-auth/jwt";
import "./auth";
import { getAuthRecord, getMember, getSessionUser, isLoginEmailAllowed } from "@/lib/repo";
import { sealSetupCode } from "@/lib/setup-code";
import { proxy } from "./proxy";

// bcrypt at cost 12 on every attempt.
vi.setConfig({ testTimeout: 30_000 });

type User = Record<string, unknown>;
interface CapturedConfig {
  providers: Array<{ authorize: (credentials: Record<string, string>, request: Request) => Promise<User | null> }>;
  callbacks: {
    jwt: (args: { token: User; user?: User }) => Promise<User>;
    session: (args: { session: User; token: User }) => Promise<User>;
  };
}

/** The empty shell @auth/core hands the session callback before it runs (see @auth/core/lib/actions/session.js). */
function blankSession(token: User): User {
  return { user: { name: token.name, email: token.email, image: null }, expires: "2099-01-01T00:00:00.000Z" };
}

/**
 * What a caller of auth() ACTUALLY receives, not what the callback returned.
 *
 * next-auth's server-side wrapper re-spreads the result as
 * `{ user: token, ...callbackResult }` (node_modules/next-auth/lib/index.js
 * getSession), so a callback that merely omits `user` leaks the raw JWT as the
 * session user. The degrade path is only correct if it survives THIS, which is
 * why every assertion below goes through it rather than reading the callback's
 * return value directly.
 */
async function sessionAsSeenByCallers(token: User): Promise<User> {
  const result = await authConfig().callbacks.session({ session: blankSession(token), token });
  return { user: token, ...result };
}

const CODE = "ABCD2345";

function authConfig(): CapturedConfig {
  return captured.config as CapturedConfig;
}

/** Each test signs in from its own address: the in-process rate limiter outlives a test. */
function signInRequest(ip: string): Request {
  return new Request("http://localhost/api/auth/callback/credentials", { headers: { "x-forwarded-for": ip } });
}

beforeEach(() => {
  vi.mocked(isLoginEmailAllowed).mockReset().mockResolvedValue(true);
  vi.mocked(getMember).mockReset().mockResolvedValue({ firstName: "Ada", lastName: "Lovelace", role: "general" } as never);
  vi.mocked(getAuthRecord)
    .mockReset()
    .mockImplementation(async (_orgId, email) => ({
      email,
      passwordHash: null,
      setupCode: sealSetupCode(CODE),
      role: "general",
      mustChangePassword: true,
      status: "active",
      signupComplete: true,
    }));
  vi.mocked(getToken).mockReset();
  vi.mocked(getSessionUser)
    .mockReset()
    .mockImplementation(async (orgId, email) => ({
      id: "usr_1",
      email,
      role: "general",
      status: "active",
      orgId,
      mustChangePassword: false,
      signupCompletedAt: new Date("2026-01-01T00:00:00.000Z"),
    }));
});

describe("signing in with a setup code", () => {
  it("a member can sign in with a setup code — typed loosely — and is sent to /set-password", async () => {
    const { providers, callbacks } = authConfig();

    const user = await providers[0].authorize(
      { email: " Ada@Bison.Howard.edu ", password: " abcd-2345 ", orgId: "org-1" },
      signInRequest("10.0.0.1"),
    );
    expect(user).toMatchObject({ email: "ada@bison.howard.edu", mustChangePassword: true });

    const token = await callbacks.jwt({ token: {}, user: user! });
    vi.mocked(getToken).mockResolvedValue(token as never);
    const res = await proxy(new NextRequest(new URL("/events", "http://localhost")));

    expect(new URL(res.headers.get("location")!).pathname).toBe("/set-password");
  });

  it("a wrong code is rejected", async () => {
    const user = await authConfig().providers[0].authorize(
      { email: "grace@bison.howard.edu", password: "ABCD2346", orgId: "org-1" },
      signInRequest("10.0.0.2"),
    );
    expect(user).toBeNull();
  });

  it("an email the sign-in domain gate rejects never gets in, even with the right code", async () => {
    vi.mocked(isLoginEmailAllowed).mockResolvedValue(false);

    const user = await authConfig().providers[0].authorize(
      { email: "someone@gmail.com", password: CODE, orgId: "org-1" },
      signInRequest("10.0.0.3"),
    );

    expect(user).toBeNull();
    expect(getAuthRecord).not.toHaveBeenCalled();
  });
});


describe("the session callback", () => {
  const TOKEN: User = { email: "ada@bison.howard.edu", orgId: "org-1", role: "admin", status: "active" };

  it("selects only the seven session columns — never passwordHash or setupCode", async () => {
    const session = await sessionAsSeenByCallers({ ...TOKEN });

    expect(getSessionUser).toHaveBeenCalledWith("org-1", "ada@bison.howard.edu");
    // getAuthRecord is the credentials-only getter: a session check must never
    // reach for it, which is what dragged passwordHash/setupCode — and the
    // whole-row SELECT that broke on a missing column — into every page.
    expect(getAuthRecord).not.toHaveBeenCalled();

    const user = session.user as Record<string, unknown>;
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("setupCode");
    expect(user).toMatchObject({
      id: "usr_1",
      email: "ada@bison.howard.edu",
      orgId: "org-1",
      role: "general",
      status: "active",
      mustChangePassword: false,
      signupComplete: true,
    });
  });

  it("reads role and status live, not from the token", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "usr_1",
      email: "ada@bison.howard.edu",
      role: "eboard",
      status: "suspended",
      orgId: "org-1",
      mustChangePassword: true,
      signupCompletedAt: new Date(),
    });

    // The token still says admin/active from when it was minted.
    const session = await sessionAsSeenByCallers({ ...TOKEN });

    expect(session.user).toMatchObject({ role: "eboard", status: "suspended", mustChangePassword: true });
  });

  it("a null latch is mid-signup", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "usr_1",
      email: "ada@bison.howard.edu",
      role: "general",
      status: "active",
      orgId: "org-1",
      mustChangePassword: false,
      signupCompletedAt: null,
    });

    const session = await sessionAsSeenByCallers({ ...TOKEN });

    expect((session.user as Record<string, unknown>).signupComplete).toBe(false);
  });

  describe("degrading on a database error", () => {
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warn = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("logs the user out instead of throwing — the public layout must still render /signin", async () => {
      vi.mocked(getSessionUser).mockRejectedValue(
        // The exact shape of the outage this whole change exists for.
        new Error('The column `User.setupCode` does not exist in the current database.'),
      );

      const session = await sessionAsSeenByCallers({ ...TOKEN });

      // Not a throw: auth() returns, so (public)/layout.tsx renders.
      expect(session.user).toBeUndefined();
      // And it is genuinely signed out, NOT the token leaking through the
      // `{ user: token, ...result }` spread with role "admin" attached.
      expect(session).not.toMatchObject({ user: { role: "admin" } });
      expect(warn).toHaveBeenCalled();
    });

    it("a deleted account is signed out too", async () => {
      vi.mocked(getSessionUser).mockResolvedValue(null);

      const session = await sessionAsSeenByCallers({ ...TOKEN });

      expect(session.user).toBeUndefined();
    });

    it("a token with no identity is signed out without touching the database", async () => {
      const session = await sessionAsSeenByCallers({ email: "", orgId: "" });

      expect(session.user).toBeUndefined();
      expect(getSessionUser).not.toHaveBeenCalled();
    });
  });
});

/**
 * The signup gate on the member layout — the guard that keeps an unfinished
 * profile out of the app.
 *
 * Called as a function with mocked session/header boundaries: what matters is
 * which paths it redirects and where to, not what it renders.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

class RedirectError extends Error {
  constructor(readonly target: string) {
    super(`redirect:${target}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectError(target);
  },
}));

let pathname = "/events";
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (key: string) => (key === "x-pathname" ? pathname : null) }),
}));

const requireSession = vi.fn();
vi.mock("@/lib/session", () => ({ requireSession: () => requireSession() }));

// Chrome only; the gate runs before it matters.
vi.mock("@/components/MemberNav", () => ({ default: () => null }));

import { AppError } from "@/lib/errors";
import MemberLayout from "./layout";

function session(signupComplete: boolean) {
  return {
    user: { email: "ada@bison.howard.edu", orgId: "org-1", role: "general", status: "active", signupComplete },
  };
}

async function visit(path: string, signupComplete: boolean): Promise<string | null> {
  pathname = path;
  requireSession.mockResolvedValue(session(signupComplete));
  try {
    await MemberLayout({ children: null });
    return null;
  } catch (err) {
    if (err instanceof RedirectError) return err.target;
    throw err;
  }
}

beforeEach(() => {
  requireSession.mockReset();
});

describe("a mid-signup account is redirected off every protected route", () => {
  for (const path of ["/events", "/dashboard", "/account", "/leaderboard", "/admin"]) {
    it(`${path} -> /join/resume, carrying where they were going`, async () => {
      expect(await visit(path, false)).toBe(`/join/resume?callbackUrl=${encodeURIComponent(path)}`);
    });
  }

  it("a nested route is redirected too, and its full path is preserved", async () => {
    expect(await visit("/admin/members", false)).toBe("/join/resume?callbackUrl=%2Fadmin%2Fmembers");
  });
});

describe("a completed account is left alone", () => {
  for (const path of ["/events", "/dashboard", "/account", "/leaderboard", "/admin"]) {
    it(`${path} renders`, async () => {
      expect(await visit(path, true)).toBeNull();
    });
  }
});

describe("the two exemptions", () => {
  it("/set-password is reachable mid-signup — proxy.ts sends setup-code sessions there first", async () => {
    expect(await visit("/set-password", false)).toBeNull();
  });

  it("/pending is reachable mid-signup — that page is the explanation, not a wizard", async () => {
    expect(await visit("/pending", false)).toBeNull();
  });
});

describe("the session check still comes first", () => {
  it("an unauthenticated request goes to /signin, not to the resume flow", async () => {
    pathname = "/events";
    requireSession.mockRejectedValue(new AppError("UNAUTHENTICATED", "You must be signed in"));
    try {
      await MemberLayout({ children: null });
      throw new Error("expected a redirect");
    } catch (err) {
      expect(err).toBeInstanceOf(RedirectError);
      expect((err as RedirectError).target).toBe("/signin");
    }
  });
});

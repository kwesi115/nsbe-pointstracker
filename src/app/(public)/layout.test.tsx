/**
 * The public layout's bounce, and the exemption that keeps it from fighting the
 * signup gate.
 *
 * This guard sends signed-in users off public pages and into the app. A member
 * resuming an unfinished signup is signed in by definition, so without an
 * exemption for /join/resume this guard and (member)/layout.tsx would volley
 * forever — the same class of bug the wizard itself already needed an exemption
 * for. That exemption is what these tests pin down.
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

let pathname = "/";
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (key: string) => (key === "x-pathname" ? pathname : null) }),
}));

const auth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => auth() }));

let orgId: string | null = "org-1";
vi.mock("@/lib/org", () => ({ getOrgIdFromCookie: async () => orgId }));

vi.mock("@/lib/repo", () => ({
  getOrgById: vi.fn(async () => ({ id: "org-1", slug: "howard-nsbe", name: "Howard NSBE" })),
  getConfigValue: vi.fn(async () => "Howard NSBE"),
}));

import PublicLayout from "./layout";

async function visit(path: string, signedIn: boolean, org: string | null = "org-1"): Promise<string | null> {
  pathname = path;
  orgId = org;
  auth.mockResolvedValue(signedIn ? { user: { email: "ada@bison.howard.edu", orgId: "org-1" } } : null);
  try {
    await PublicLayout({ children: null });
    return null;
  } catch (err) {
    if (err instanceof RedirectError) return err.target;
    throw err;
  }
}

beforeEach(() => {
  auth.mockReset();
});

describe("the signed-in bounce", () => {
  it("sends a signed-in member off /signin and /org/[slug] into the app", async () => {
    expect(await visit("/signin", true)).toBe("/events");
    expect(await visit("/org/howard-nsbe", true)).toBe("/events");
  });

  it("leaves anonymous visitors alone everywhere", async () => {
    for (const path of ["/", "/signin", "/join", "/join/resume", "/org/howard-nsbe"]) {
      expect(await visit(path, false)).toBeNull();
    }
  });

  it('keeps "/" reachable for a signed-in user with no org cookie yet', async () => {
    expect(await visit("/", true, null)).toBeNull();
    expect(await visit("/", true, "org-1")).toBe("/events");
  });
});

describe("the exemptions that let a signup finish", () => {
  it("/join is exempt — the wizard signs the user in at step 3 and keeps going", async () => {
    expect(await visit("/join", true)).toBeNull();
  });

  it("/join/resume is exempt — WITHOUT THIS the gate and this guard loop forever", async () => {
    expect(await visit("/join/resume", true)).toBeNull();
  });

  it("the exemption survives a callbackUrl on the path", async () => {
    // x-pathname carries no query today, but the guard must not start bouncing
    // a resuming member if that ever changes.
    expect(await visit("/join/resume?callbackUrl=%2Fevents", true)).toBeNull();
  });

  it("a lookalike path is NOT exempt", async () => {
    expect(await visit("/joinsomething", true)).toBe("/events");
  });
});

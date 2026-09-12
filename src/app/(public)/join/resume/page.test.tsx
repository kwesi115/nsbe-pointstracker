/**
 * /join/resume's own guard: who it lets in, and who it sends away.
 *
 * The page is a Server Component, so it is called as a function with mocked
 * session/repo boundaries rather than rendered — the assertions here are about
 * redirects, which is all this page decides.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Member } from "@/lib/types";

/** next/navigation's redirect throws to unwind; mirror that so control flow is testable. */
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

const requireSession = vi.fn();
vi.mock("@/lib/session", () => ({ requireSession: () => requireSession() }));

const getSignupUser = vi.fn();
vi.mock("@/lib/repo", () => ({
  getSignupUser: (...args: unknown[]) => getSignupUser(...args),
  getOrgById: vi.fn(async () => ({ id: "org-1", slug: "howard-nsbe", name: "Howard NSBE" })),
  getCoreFormUiConfig: vi.fn(async () => ({
    majors: ["Computer Engineering"],
    houses: [],
    membershipSiteUrl: "",
    houseTestUrl: "",
    nationalMembershipUrl: "",
  })),
}));

// The flow itself is a client component; this page only decides whether to
// reach it.
vi.mock("@/components/join/SignupResume", () => ({ default: () => null }));

import { AppError } from "@/lib/errors";
import ResumeSignupPage from "./page";

const SESSION = { user: { email: "ada@bison.howard.edu", orgId: "org-1", role: "general" } };

/** A row with every required answer present. */
function completeMember(overrides: Partial<Member> = {}): Member {
  return {
    role: "general",
    firstName: "Ada",
    lastName: "Lovelace",
    studentId: "9001",
    phone: "202-555-0100",
    personalEmail: "ada@example.com",
    tshirtSize: "M",
    classification: "junior",
    major: "Computer Engineering",
    majorOther: "",
    profileSeason: "2026-2027",
    duesPaidReported: true,
    nationalMemberReported: true,
    membershipSeason: "2026-2027",
    nsbeMembershipId: "",
    house: "House Turing",
    houseVerifiedAt: new Date(),
    resumeFileId: null,
    signupCompletedAt: null,
    ...overrides,
  } as Member;
}

/** Mid-signup: created by the wizard's step 3 and abandoned. */
function incompleteMember(): Member {
  return completeMember({
    phone: "",
    personalEmail: "",
    duesPaidReported: null,
    nationalMemberReported: null,
    house: "",
    houseVerifiedAt: null,
  });
}

async function render(search: Record<string, string> = {}): Promise<{ redirectedTo: string | null }> {
  try {
    await ResumeSignupPage({ searchParams: Promise.resolve(search) });
    return { redirectedTo: null };
  } catch (err) {
    if (err instanceof RedirectError) return { redirectedTo: err.target };
    throw err;
  }
}

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue(SESSION);
  getSignupUser.mockReset().mockResolvedValue(incompleteMember());
});

describe("who /join/resume lets in", () => {
  it("renders for a mid-signup account — no redirect", async () => {
    const { redirectedTo } = await render();
    expect(redirectedTo).toBeNull();
  });

  it("redirects a member who has already completed signup to /events", async () => {
    getSignupUser.mockResolvedValue(completeMember({ signupCompletedAt: new Date() }));
    expect((await render()).redirectedTo).toBe("/events");
  });

  it("redirects a member whose data already satisfies the predicate, even without the latch", async () => {
    // The accounts the backfill caught — and any it missed.
    getSignupUser.mockResolvedValue(completeMember({ signupCompletedAt: null }));
    expect((await render()).redirectedTo).toBe("/events");
  });

  it("sends a completed member back to where they were originally headed", async () => {
    getSignupUser.mockResolvedValue(completeMember({ signupCompletedAt: new Date() }));
    expect((await render({ callbackUrl: "/admin/members" })).redirectedTo).toBe("/admin/members");
  });

  it("ignores an off-site callbackUrl rather than forwarding to it", async () => {
    getSignupUser.mockResolvedValue(completeMember({ signupCompletedAt: new Date() }));
    expect((await render({ callbackUrl: "https://evil.example.com" })).redirectedTo).toBe("/events");
  });

  it("redirects to /signin when there is no session — nothing to resume without an account", async () => {
    requireSession.mockRejectedValue(new AppError("UNAUTHENTICATED", "You must be signed in"));
    expect((await render()).redirectedTo).toBe("/signin");
  });

  it("redirects when the session's account no longer exists", async () => {
    getSignupUser.mockResolvedValue(null);
    expect((await render()).redirectedTo).toBe("/events");
  });

  it("an ADMIN account is never held here", async () => {
    getSignupUser.mockResolvedValue(
      completeMember({
        role: "admin",
        lastName: "",
        studentId: "",
        classification: "",
        major: "",
        phone: "",
        personalEmail: "",
        duesPaidReported: null,
        nationalMemberReported: null,
        house: "",
        houseVerifiedAt: null,
        signupCompletedAt: null,
      }),
    );
    expect((await render()).redirectedTo).toBe("/events");
  });
});

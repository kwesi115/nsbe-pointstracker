/**
 * The routing half of the signup gate: which paths it applies to, and — the
 * part worth proving rather than asserting — that it cannot loop.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_POST_SIGNUP_PATH,
  RESUME_PATH,
  isResumePath,
  isSafeCallback,
  postSignupDestination,
  resumeUrlFor,
  signupGateApplies,
} from "./signup-routes";

const PROTECTED = ["/events", "/dashboard", "/account", "/leaderboard", "/admin"];

describe("which routes the gate applies to", () => {
  it("every protected prefix is gated, at the prefix and below it", () => {
    for (const path of PROTECTED) {
      expect(signupGateApplies(path)).toBe(true);
      expect(signupGateApplies(`${path}/something/deeper`)).toBe(true);
    }
  });

  it("/set-password is exempt — a setup-code session has to get there first", () => {
    expect(signupGateApplies("/set-password")).toBe(false);
    expect(signupGateApplies("/set-password?callbackUrl=%2Fevents")).toBe(false);
  });

  it("/pending is exempt — an account that can't use the app yet gets the explanation, not a wizard", () => {
    expect(signupGateApplies("/pending")).toBe(false);
  });

  it("a path that looks like an exempt one but isn't stays gated", () => {
    expect(signupGateApplies("/set-password-other")).toBe(true);
    expect(signupGateApplies("/pendingish")).toBe(true);
  });
});

describe("the resume route is recognised by both guards", () => {
  it("matches itself and anything under it", () => {
    expect(isResumePath(RESUME_PATH)).toBe(true);
    expect(isResumePath(`${RESUME_PATH}/anything`)).toBe(true);
  });

  it("does not match the wizard it lives beside", () => {
    expect(isResumePath("/join")).toBe(false);
    // A sibling that merely starts with the same letters is not the resume flow.
    expect(isResumePath("/join/resumed-elsewhere")).toBe(false);
  });
});

describe("no redirect loop is possible between the two guards", () => {
  /**
   * The loop this models is the one the brief called out twice, and the one the
   * earlier layout-vs-wizard bug actually was.
   *
   * Both guards read ONE value — the member's row, live — so they are modelled
   * here as one predicate consulted by two rules:
   *
   *   member layout   incomplete && gated(path)  ->  /join/resume
   *   resume page     complete                   ->  callbackUrl or /events
   *   public layout   signed in && !exempt(path) ->  /events
   *
   * Following the redirects to a fixed point is what proves it terminates. A
   * JWT-based gate would fail exactly this test with `complete: true`, because
   * middleware's stale copy would still say incomplete and bounce /events back
   * to the resume page forever.
   */
  function follow(start: string, complete: boolean, hops = 12): string[] {
    const visited: string[] = [];
    let path = start;
    for (let i = 0; i < hops; i++) {
      visited.push(path);
      // (member)/layout.tsx
      if (!complete && signupGateApplies(path) && !isResumePath(path)) {
        path = resumeUrlFor(path).split("?")[0];
        continue;
      }
      // (public)/join/resume/page.tsx
      if (complete && isResumePath(path)) {
        path = DEFAULT_POST_SIGNUP_PATH;
        continue;
      }
      // (public)/layout.tsx — signed in, bounced off public pages, with the
      // resume flow exempted. Without that exemption this is the loop.
      if (isResumePath(path) && complete) {
        path = DEFAULT_POST_SIGNUP_PATH;
        continue;
      }
      return visited;
    }
    throw new Error(`did not settle: ${visited.join(" -> ")}`);
  }

  it("an incomplete signup settles on the resume page from every protected route", () => {
    for (const path of PROTECTED) {
      const trail = follow(path, false);
      expect(trail[trail.length - 1]).toBe(RESUME_PATH);
    }
  });

  it("a complete signup settles in the app, and never back on the resume page", () => {
    const trail = follow(RESUME_PATH, true);
    expect(trail[trail.length - 1]).toBe(DEFAULT_POST_SIGNUP_PATH);
    expect(trail.filter((p) => p === RESUME_PATH)).toHaveLength(1);
  });

  it("the moment signup completes — the exact instant a stale token would loop — settles immediately", () => {
    // Someone finished the last step; the row says complete. A gate reading a
    // token would still say incomplete here.
    const trail = follow(DEFAULT_POST_SIGNUP_PATH, true);
    expect(trail).toEqual([DEFAULT_POST_SIGNUP_PATH]);
  });

  it("the resume page is never gated against itself", () => {
    // If the member layout also gated /join/resume, this would never settle.
    const trail = follow(RESUME_PATH, false);
    expect(trail).toEqual([RESUME_PATH]);
  });

  /**
   * The loop this feature very nearly shipped with, kept as a regression.
   *
   * The two guards must not merely read the same DATA — they must ask the same
   * QUESTION. An earlier cut had the member layout testing "is the latch set?"
   * while /join/resume tested "is the latch set OR is the profile already
   * complete?". Those differ for exactly one kind of row — no latch, complete
   * profile, which is what an admin filling a member's profile in by hand
   * produces — and for that row the two bounced the member between /events and
   * /join/resume forever.
   *
   * lib/signup.ts signupIsComplete is now the single question, reached through
   * AuthRecord.signupComplete so it cannot be re-derived differently. This
   * models both spellings to show the fix is what matters.
   */
  function followWithTwoOpinions(start: string, layoutSaysComplete: boolean, pageSaysComplete: boolean): string[] {
    const visited: string[] = [];
    let path = start;
    for (let i = 0; i < 12; i++) {
      visited.push(path);
      if (!layoutSaysComplete && signupGateApplies(path) && !isResumePath(path)) {
        path = RESUME_PATH;
        continue;
      }
      if (pageSaysComplete && isResumePath(path)) {
        path = DEFAULT_POST_SIGNUP_PATH;
        continue;
      }
      return visited;
    }
    throw new Error(`did not settle: ${visited.join(" -> ")}`);
  }

  it("two guards asking DIFFERENT questions would loop — which is why they ask one", () => {
    // The old asymmetry: layout sees "incomplete", page sees "complete".
    expect(() => followWithTwoOpinions("/events", false, true)).toThrow(/did not settle/);
  });

  it("one shared predicate settles for every combination of row state", () => {
    for (const complete of [true, false]) {
      for (const start of [...PROTECTED, RESUME_PATH]) {
        expect(() => followWithTwoOpinions(start, complete, complete)).not.toThrow();
      }
    }
  });
});

describe("callbackUrl is carried, but only when it is safe to", () => {
  it("carries the route the member was trying to reach", () => {
    expect(resumeUrlFor("/admin/members")).toBe(`${RESUME_PATH}?callbackUrl=%2Fadmin%2Fmembers`);
    expect(postSignupDestination("/admin/members")).toBe("/admin/members");
  });

  it("falls back to /events with nothing to go back to", () => {
    expect(postSignupDestination(undefined)).toBe(DEFAULT_POST_SIGNUP_PATH);
    expect(postSignupDestination(null)).toBe(DEFAULT_POST_SIGNUP_PATH);
    expect(postSignupDestination("")).toBe(DEFAULT_POST_SIGNUP_PATH);
  });

  it("refuses an off-site destination — this redirect is not an open redirect", () => {
    for (const hostile of ["https://evil.example.com/x", "//evil.example.com", "/\\evil.example.com", "javascript:alert(1)"]) {
      expect(isSafeCallback(hostile)).toBe(false);
      expect(postSignupDestination(hostile)).toBe(DEFAULT_POST_SIGNUP_PATH);
      expect(resumeUrlFor(hostile)).toBe(RESUME_PATH);
    }
  });

  it("refuses the resume page as its own destination, which would be a loop of one", () => {
    expect(isSafeCallback(RESUME_PATH)).toBe(false);
    expect(postSignupDestination(RESUME_PATH)).toBe(DEFAULT_POST_SIGNUP_PATH);
  });
});

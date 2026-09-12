// @vitest-environment jsdom
/**
 * The resume flow in the browser: which step it opens on, what the progress
 * indicator claims, and the way out.
 *
 * The step components are the wizard's own (see steps.tsx), so this is also the
 * check that reusing them actually works rather than only type-checking.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { click, flush } from "@/test/dom";
import type { StepKey } from "@/lib/signup";

const completeSignupAction = vi.fn();
const updateContactAction = vi.fn();
const updateAboutAction = vi.fn();
const setHouseAction = vi.fn();

vi.mock("@/app/(public)/join/actions", () => ({
  completeSignupAction: (...args: unknown[]) => completeSignupAction(...args),
  updateContactAction: (...args: unknown[]) => updateContactAction(...args),
  updateAboutAction: (...args: unknown[]) => updateAboutAction(...args),
  updateMembershipAction: vi.fn(async () => ({ error: null })),
  setHouseAction: (...args: unknown[]) => setHouseAction(...args),
  setResumeAction: vi.fn(async () => ({ error: null })),
}));

const signOutAction = vi.fn();
vi.mock("@/app/(member)/actions", () => ({ signOutAction: () => signOutAction() }));

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import SignupResume, { type ResumeMember } from "./SignupResume";

const CONFIG = {
  majors: ["Computer Engineering", "Mechanical Engineering"],
  houses: [{ code: "turing", name: "House Turing", color: "#123456" }],
  membershipSiteUrl: "https://example.com/dues",
  houseTestUrl: "https://example.com/house",
  nationalMembershipUrl: "https://nsbe.org/memberships/",
};

/** A row abandoned right after the wizard created the account. */
const AFTER_ACCOUNT: ResumeMember = {
  firstName: "Ada",
  lastName: "Lovelace",
  studentId: "9001",
  classification: "junior",
  major: "Computer Engineering",
  majorOther: "",
  phone: "",
  personalEmail: "",
  tshirtSize: "",
  duesPaidReported: null,
  nationalMemberReported: null,
  nsbeMembershipId: "",
  house: "",
  resumeFileId: null,
};

function renderFlow(missing: StepKey[], member: ResumeMember = AFTER_ACCOUNT, destination = "/events") {
  return render(
    <SignupResume
      config={CONFIG}
      role="general"
      member={member}
      initialMissingSteps={missing}
      destination={destination}
    />,
  );
}

function progressText(): string {
  return screen.getByText(/^Step \d+ of \d+/).textContent ?? "";
}

beforeEach(() => {
  for (const m of [completeSignupAction, updateContactAction, updateAboutAction, setHouseAction, signOutAction, push]) {
    m.mockReset();
  }
  completeSignupAction.mockResolvedValue({ error: null, destination: "/events", missingSteps: [] });
  updateContactAction.mockResolvedValue({ error: null });
  updateAboutAction.mockResolvedValue({ error: null });
  setHouseAction.mockResolvedValue({ error: null });
});

describe("it opens on the first outstanding step, numbered as it was first time through", () => {
  it("a signup abandoned after the account step opens on Contact — step 4 of 7", () => {
    renderFlow(["contact", "membership", "house"]);
    expect(screen.getByRole("heading", { name: "Contact" })).toBeTruthy();
    expect(progressText()).toContain("Step 4 of 7");
  });

  it("a signup abandoned after the House step opens on Resume — step 7 of 7, not step 1", () => {
    renderFlow(["resume"]);
    expect(screen.getByRole("heading", { name: "Resume" })).toBeTruthy();
    expect(progressText()).toContain("Step 7 of 7");
  });

  it("an admin-provisioned account opens on About — step 3 of 7", () => {
    renderFlow(["about", "contact", "membership", "house"]);
    expect(screen.getByRole("heading", { name: "About you" })).toBeTruthy();
    expect(progressText()).toContain("Step 3 of 7");
  });

  it("progress counts the whole wizard, not what's left — one step left is still step 6 of 7", () => {
    renderFlow(["house"]);
    expect(screen.getByRole("heading", { name: "NSBE House" })).toBeTruthy();
    expect(progressText()).toContain("Step 6 of 7");
  });
});

describe("each step saves as it completes, then hands over to the next", () => {
  it("Contact saves, then Membership is shown with its real number", async () => {
    renderFlow(["contact", "membership", "house"]);

    const phone = screen.getByLabelText(/Phone/) as HTMLInputElement;
    const personalEmail = screen.getByLabelText(/Personal email/) as HTMLInputElement;
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(phone, { target: { value: "202-555-0100" } });
    fireEvent.change(personalEmail, { target: { value: "ada@example.com" } });

    await click(screen.getByRole("button", { name: "Continue" }));
    await flush();

    expect(updateContactAction).toHaveBeenCalledWith(
      expect.objectContaining({ phone: "202-555-0100", personalEmail: "ada@example.com" }),
    );
    expect(screen.getByRole("heading", { name: "Membership" })).toBeTruthy();
    expect(progressText()).toContain("Step 5 of 7");
    // Not finished yet — there are steps left.
    expect(completeSignupAction).not.toHaveBeenCalled();
  });
});

describe("finishing the last outstanding step releases the member", () => {
  it("latches the signup and navigates to the destination", async () => {
    completeSignupAction.mockResolvedValue({ error: null, destination: "/admin/members", missingSteps: [] });
    renderFlow(["resume"], AFTER_ACCOUNT, "/admin/members");

    await click(screen.getByRole("button", { name: "Do this later" }));
    await flush();

    expect(completeSignupAction).toHaveBeenCalledWith(
      expect.objectContaining({ callbackUrl: "/admin/members", houseSkipped: false }),
    );
    expect(push).toHaveBeenCalledWith("/admin/members");
  });

  it("carries the House skip, which the row cannot record", async () => {
    renderFlow(["house"]);

    // "I haven't taken the test yet" is a complete answer on its own.
    await click(screen.getByRole("button", { name: /haven't taken the test yet/i }));
    await click(screen.getByRole("button", { name: "Continue" }));
    await flush();

    expect(setHouseAction).toHaveBeenCalledWith(expect.objectContaining({ houseSkipped: true }));
    expect(completeSignupAction).toHaveBeenCalledWith(expect.objectContaining({ houseSkipped: true }));
    expect(push).toHaveBeenCalledWith("/events");
  });

  it("a refused finish keeps the member here and says so, rather than pretending to be done", async () => {
    completeSignupAction.mockResolvedValue({
      error: "There are still steps left to finish.",
      destination: null,
      missingSteps: ["house"],
    });
    renderFlow(["resume"]);

    await click(screen.getByRole("button", { name: "Do this later" }));
    await flush();

    expect(screen.getByRole("alert").textContent).toContain("still steps left");
    expect(push).not.toHaveBeenCalled();
  });
});

describe('"Finish this later" is a clean exit, not a way in', () => {
  it("submits to the app's sign-out and explains that answers are saved", () => {
    renderFlow(["contact", "membership", "house"]);

    const exit = screen.getByRole("button", { name: "Finish this later" });
    expect(exit).toBeTruthy();
    // A real form submit to the sign-out action, so it works without JS too.
    expect((exit as HTMLButtonElement).form).toBeTruthy();
    expect(screen.getByText(/Sign in any time to pick up where you left off/i)).toBeTruthy();
  });

  it("does not navigate into the app", () => {
    renderFlow(["contact"]);
    expect(push).not.toHaveBeenCalled();
    // No link or button here offers a way past the gate.
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels.join(" ")).not.toMatch(/skip for now|continue to app|go to events/i);
  });
});

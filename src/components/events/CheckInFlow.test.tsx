// @vitest-environment jsdom
/**
 * What a member sees when a check-in is rejected — and what the client sends
 * in the first place. The server half is repo.checkin.test.ts.
 */

import "@/test/dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/forms/revealField", () => ({ revealField: vi.fn() }));
import { revealField } from "@/components/forms/revealField";
import CheckInFlow from "./CheckInFlow";

const SEASON = "2026-2027";

const COMPLETE_MEMBER = {
  role: "general" as const,
  firstName: "Ada",
  lastName: "Lovelace",
  studentId: "00123456",
  phone: "555-0100",
  personalEmail: "ada@gmail.com",
  tshirtSize: "M" as const,
  classification: "junior" as const,
  major: "Astrophysics", // a free-text major from an earlier "Other" check-in
  majorOther: "Astrophysics",
  profileSeason: SEASON,
  nsbeMembershipId: "",
  house: "House Turing",
  houseVerifiedAt: new Date("2026-09-01"),
  resumeFileId: "file_1",
  duesPaidReported: true,
  nationalMemberReported: true,
  membershipSeason: SEASON,
};

const CONFIG = {
  majors: ["Computer Science", "Biology"],
  houses: [{ code: "TURING", name: "House Turing", color: "#C8102E" }],
  membershipSiteUrl: "",
  houseTestUrl: "",
  nationalMembershipUrl: "",
  currentSeason: SEASON,
};

type Reply = { ok: boolean; body: unknown };
let replies: Reply[];
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  replies = [];
  fetchMock = vi.fn(async () => {
    const next = replies.shift() ?? { ok: true, body: {} };
    return { ok: next.ok, json: async () => next.body } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  // jsdom has no layout, so no scrollIntoView — CodeGate calls it on focus.
  Element.prototype.scrollIntoView ??= () => {};
  if (!("CSS" in globalThis) || !globalThis.CSS?.escape) vi.stubGlobal("CSS", { escape: (s: string) => s });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(revealField).mockClear();
});

/** Past the code gate, onto the form (or the one-tap screen). */
async function reachForm(member = COMPLETE_MEMBER) {
  replies.push({ ok: true, body: { ok: true } }); // verify-code
  render(<CheckInFlow eventId="ev_1" extraFields={[]} member={member} email="ada@bison.howard.edu" coreFormConfig={CONFIG} />);
  fireEvent.change(screen.getByLabelText("Enter the code on the screen"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Check in" });
}

function registerBody() {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).endsWith("/register"));
  return JSON.parse(String((call![1] as RequestInit).body));
}

describe("what the client submits", () => {
  it("on the one-tap screen, sends no profile fields at all and reports that it rendered none", async () => {
    await reachForm();
    replies.push({ ok: true, body: { pointsAwarded: 2, total: 4, rank: 1, eligible: true, eboardPointsAwarded: null } });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));
    await screen.findByText("Checked in");
    expect(registerBody()).toMatchObject({ core: {}, rendered: [] });
  });
});

describe("when the server names a field", () => {
  it("that this form can show: opens it, highlights it, names it, and scrolls to it", async () => {
    await reachForm();
    replies.push({ ok: false, body: { code: "VALIDATION_FAILED", message: "Check the highlighted fields.", fieldErrors: { major: "Select a major" } } });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    expect(await screen.findByText("Fix the highlighted field: Major.")).toBeTruthy();
    expect(screen.getByText("Select a major")).toBeTruthy();
    expect(screen.getByLabelText(/^Major/)).toBeTruthy();
    await waitFor(() => expect(revealField).toHaveBeenCalled());
    expect(vi.mocked(revealField).mock.calls[0][0].getAttribute("data-core-field")).toBe("major");
    expect(screen.queryByText("Check the highlighted fields.")).toBeNull();
  });

  it("that this form can't show: says what by name and links to /account instead of 'Check the highlighted fields.'", async () => {
    await reachForm({ ...COMPLETE_MEMBER, role: "admin" as never, studentId: "" });
    replies.push({ ok: false, body: { code: "VALIDATION_FAILED", message: "Check the highlighted fields.", fieldErrors: { studentId: "Required" } } });
    fireEvent.click(screen.getByRole("button", { name: "Check in" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("We couldn't check you in: Student ID on your profile needs attention.");
    expect(screen.getByRole("link", { name: "Update it on your account" }).getAttribute("href")).toBe("/account");
    expect(screen.queryByText("Check the highlighted fields.")).toBeNull();
  });
});

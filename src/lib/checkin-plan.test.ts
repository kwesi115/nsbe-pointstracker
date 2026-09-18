/**
 * The check-in submit plan (lib/core-form.ts planCheckIn + liveFields) — the
 * one computation that decides both what the form renders and what the
 * server validates. Each case here is a way the two used to disagree, ending
 * in "Check the highlighted fields." with nothing highlighted.
 *
 * Pure — no database. repo.checkin.test.ts runs the same cases through
 * registerForEvent against Postgres, and CheckInFlow.test.tsx covers what the
 * member sees.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { logCheckInRejection, unrenderedErrorKeys } from "./checkin-diagnostics";
import {
  getMissingFields,
  liveFields,
  planCheckIn,
  validateCoreAnswers,
  type CheckInProfile,
  type CoreFieldKey,
  type RenderedFieldKey,
} from "./core-form";
import { AppError } from "./errors";
import type { Audience, Role } from "./types";

const SEASON = "2026-2027";
const MAJORS = ["Computer Science", "Biology"];
const HOUSES = [{ code: "TURING", name: "House Turing", color: "#C8102E" }];

const COMPLETE: CheckInProfile = {
  role: "general",
  firstName: "Ada",
  lastName: "Lovelace",
  studentId: "00123456",
  phone: "555-0100",
  personalEmail: "ada@gmail.com",
  tshirtSize: "M",
  classification: "junior",
  major: "Computer Science",
  majorOther: "",
  profileSeason: SEASON,
  duesPaidReported: true,
  nationalMemberReported: true,
  membershipSeason: SEASON,
  house: "House Turing",
  houseVerifiedAt: new Date("2026-09-01"),
  resumeFileId: "file_1",
  nsbeMembershipId: "",
};

/** What CheckInFlow used to send on every submit: the stored profile, whether or not a field was rendered. */
function seededPayload(u: CheckInProfile): Record<string, unknown> {
  return JSON.parse(
    JSON.stringify({
      firstName: u.firstName,
      lastName: u.lastName,
      studentId: u.studentId,
      phone: u.phone || undefined,
      personalEmail: u.personalEmail || undefined,
      classification: u.classification || undefined,
      major: u.major || undefined,
      majorOther: u.majorOther || undefined,
      nsbeMembershipId: u.nsbeMembershipId || undefined,
    }),
  );
}

/** What the form shows with nothing pressed — liveFields with no edits, same call CoreCheckInForm makes. */
function rendered(user: CheckInProfile, audience: Audience = "all", majorValue?: string): RenderedFieldKey[] {
  return [...liveFields({ user, event: { audience }, config: { SEASON }, editing: new Set(), majorValue })];
}

/** The server side: plan, then validate — exactly registerForEvent's sequence. */
function submit(
  user: CheckInProfile,
  answers: Record<string, unknown>,
  shown: readonly unknown[] | null,
  audience: Audience = "all",
) {
  const plan = planCheckIn({ user, event: { audience }, config: { SEASON }, answers, rendered: shown });
  const result = validateCoreAnswers({ role: user.role, majors: MAJORS, houses: HOUSES, missing: plan.required }, plan.answers);
  return { plan, result };
}

function fieldErrorsOf(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) return err.fieldErrors ?? {};
    throw err;
  }
  throw new Error("expected a validation failure");
}

describe("the reported failure: an error on a field the member was never shown", () => {
  // Each of these used to be a 422 while the form rendered NOTHING — the
  // one-tap check-in screen — so nothing could ever be highlighted.
  const cases: Array<[string, CheckInProfile, string[]?]> = [
    ["a free-text major written by an earlier 'Other' check-in", { ...COMPLETE, major: "Astrophysics", majorOther: "Astrophysics" }],
    ["a major since removed from MAJORS_LIST", { ...COMPLETE, major: "Mechanical Engineering" }],
    ["a personal email saved on /account without the format check", { ...COMPLETE, personalEmail: "ada@gmail" }],
    ["an ADMIN with no student ID on file", { ...COMPLETE, role: "admin", studentId: "" }],
    ["an ADMIN whose NSBE ID is over the length limit", { ...COMPLETE, role: "admin", nsbeMembershipId: "x".repeat(60) }],
  ];

  for (const [label, user] of cases) {
    it(`${label} — still checks in`, () => {
      expect(getMissingFields(user, { audience: "all" }, { SEASON })).toEqual([]);
      // The new client sends only what it rendered: the one-tap screen renders nothing.
      expect(() => submit(user, {}, [])).not.toThrow();
      // And an older client still sending the whole seeded profile is safe too:
      // an unchanged echo of what's on file is dropped, never validated.
      expect(() => submit(user, seededPayload(user), null)).not.toThrow();
    });
  }
});

describe("a user whose profile is missing a field the client did not render", () => {
  it("still checks in — the field is logged as required-but-not-rendered, not thrown at the member", () => {
    // Loaded the page with dues on file; an admin revoked them before submit.
    const atSubmit: CheckInProfile = { ...COMPLETE, duesPaidReported: false };
    const shown = rendered(COMPLETE); // what the page rendered at load: nothing membership-related
    expect(shown).not.toContain("duesPaid");

    const { plan } = submit(atSubmit, {}, shown);
    expect(plan.requiredButNotRendered).toEqual(["duesPaid"]);
    expect(plan.required.has("duesPaid")).toBe(false);
  });

  it("a SEASON bump between page load and submit doesn't block — the new questions wait for the next check-in", () => {
    const shown = rendered(COMPLETE);
    const plan = planCheckIn({ user: COMPLETE, event: { audience: "all" }, config: { SEASON: "2027-2028" }, answers: {}, rendered: shown });
    expect(plan.requiredButNotRendered).toEqual(["classification", "major", "duesPaid", "nationalMember"]);
    expect([...plan.required]).toEqual([]);
  });
});

describe("an EBOARD member at an EBOARD_ONLY event", () => {
  const officer: CheckInProfile = {
    ...COMPLETE,
    role: "eboard",
    duesPaidReported: null,
    nationalMemberReported: null,
    membershipSeason: "",
    house: "",
    houseVerifiedAt: null,
    resumeFileId: null,
  };

  it("is never validated against membership, House, or resume", () => {
    expect(getMissingFields(officer, { audience: "eboard_only" }, { SEASON })).toEqual([]);
    expect(rendered(officer, "eboard_only")).toEqual([]);
    expect(() => submit(officer, {}, [], "eboard_only")).not.toThrow();
  });

  it("drops membership/House/resume answers a client sends anyway, rather than failing on them", () => {
    const { plan } = submit(
      officer,
      { duesPaid: "not-a-boolean", house: "House Nope", resumeAction: "upload", studentId: "" },
      ["duesPaid", "house", "resume", "studentId"],
      "eboard_only",
    );
    expect(plan.accepted.size).toBe(0);
    expect(plan.dropped.sort()).toEqual(["duesPaid", "house", "resumeAction", "studentId"]);
  });

  it("is still asked for a genuinely missing name — and it's rendered", () => {
    const nameless = { ...officer, lastName: "" };
    expect(rendered(nameless, "eboard_only").sort()).toEqual(["firstName", "lastName"]);
    expect(fieldErrorsOf(() => submit(nameless, { firstName: "Ada" }, ["firstName", "lastName"], "eboard_only"))).toEqual({
      lastName: "Required",
    });
  });
});

describe("season flags — the form renders and the server validates the same field set", () => {
  function sameSet(user: CheckInProfile, expected: CoreFieldKey[]) {
    const shown = rendered(user);
    const missing = getMissingFields(user, { audience: "all" }, { SEASON });
    expect(missing).toEqual(expected);
    for (const f of expected) expect(shown).toContain(f);
    // Leave every question blank: the server's errors are exactly the rendered missing set.
    const errors = fieldErrorsOf(() => submit(user, {}, shown));
    for (const key of Object.keys(errors)) expect(shown).toContain(key);
    expect(Object.keys(errors).sort()).toEqual([...expected].sort());
  }

  it("a stale profileSeason: classification and major, on both sides", () => {
    sameSet({ ...COMPLETE, profileSeason: "2025-2026" }, ["classification", "major"]);
  });

  it("a stale profileSeason: confirming the same values is an answer, not an echo — it restamps the season", () => {
    const user = { ...COMPLETE, profileSeason: "2025-2026" };
    const { plan, result } = submit(user, { classification: "junior", major: "Computer Science" }, rendered(user));
    expect(plan.accepted.has("classification")).toBe(true);
    expect(result.classification).toBe("junior");
  });

  it("a stale membershipSeason: dues and national, on both sides", () => {
    sameSet({ ...COMPLETE, membershipSeason: "2025-2026" }, ["duesPaid", "nationalMember"]);
  });
});

describe("major = Other", () => {
  it("picked this session with majorOther left blank: rejected on majorOther, which is on screen", () => {
    const user = { ...COMPLETE, profileSeason: "2025-2026" };
    const shown = rendered(user, "all", "Other");
    expect(shown).toContain("majorOther");
    const errors = fieldErrorsOf(() => submit(user, { classification: "junior", major: "Other", majorOther: "" }, shown));
    expect(errors).toEqual({ majorOther: "Tell us your major" });
  });

  it("already on file with nothing beside it: majorOther is asked, rendered, and required", () => {
    const user = { ...COMPLETE, major: "Other", majorOther: "" };
    const shown = rendered(user);
    expect(shown).toContain("majorOther");
    expect(fieldErrorsOf(() => submit(user, {}, shown))).toEqual({ majorOther: "Tell us your major" });
    expect(() => submit(user, { majorOther: "Astrophysics" }, shown)).not.toThrow();
  });
});

describe("NSBE Membership ID", () => {
  it("blank never blocks a check-in", () => {
    const shown = rendered(COMPLETE);
    expect(shown).toContain("nsbeMembershipId");
    expect(() => submit(COMPLETE, { nsbeMembershipId: "" }, shown)).not.toThrow();
    expect(() => submit({ ...COMPLETE, nsbeMembershipId: "12345" }, { nsbeMembershipId: "" }, shown)).not.toThrow();
    expect(() => submit(COMPLETE, {}, shown)).not.toThrow();
    // Not asked at all where the form doesn't show it.
    expect(() => submit({ ...COMPLETE, role: "admin" }, { nsbeMembershipId: "" }, [])).not.toThrow();
  });
});

describe("a stale page can't overwrite a newer value", () => {
  it("a field the member didn't have live is never accepted, even when it differs from what's on file", () => {
    // Loaded with the old phone; changed it on /account in another tab; submitted this page.
    const now = { ...COMPLETE, phone: "555-0199" };
    const { plan } = submit(now, { phone: "555-0100" }, []);
    expect(plan.accepted.has("phone")).toBe(false);
    expect(plan.answers.phone).toBeUndefined();
  });

  it("names not on screen come from the profile, not the page", () => {
    const { plan } = submit({ ...COMPLETE, firstName: "Augusta" }, { firstName: "Ada" }, []);
    expect(plan.answers.firstName).toBe("Augusta");
  });
});

describe("diagnostics", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs every rejection with the userId, the fieldErrors and what the client rendered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logCheckInRejection({
      orgId: "org",
      userId: "user_1",
      eventId: "ev_1",
      fieldErrors: { phone: "Required" },
      message: "Check the highlighted fields.",
      rendered: ["phone"],
      missing: ["phone"],
      extraFieldKeys: [],
    });
    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({
      event: "checkin_rejected",
      userId: "user_1",
      fieldErrors: { phone: "Required" },
      rendered: ["phone"],
      unrendered: [],
    });
    expect(error).not.toHaveBeenCalled();
  });

  it("a 422 naming a field the client did not render also logs a server-side error", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logCheckInRejection({
      orgId: "org",
      userId: "user_1",
      eventId: "ev_1",
      fieldErrors: { major: "Select a major", houseProofFileId: "Upload your House test result", q1: "Required" },
      message: "Check the highlighted fields.",
      rendered: ["house"],
      missing: [],
      extraFieldKeys: ["q1"],
    });
    expect(JSON.parse(error.mock.calls[0][0])).toMatchObject({ event: "checkin_error_on_unrendered_field", unrendered: ["major"] });
  });

  it("knows which error keys have an input behind them", () => {
    expect(unrenderedErrorKeys({ _form: "Unrecognized key" }, null, [])).toEqual(["_form"]);
    expect(unrenderedErrorKeys({ resumeFileId: "x" }, ["resume"], [])).toEqual([]);
    expect(unrenderedErrorKeys({ majorOther: "x" }, ["major"], [])).toEqual(["majorOther"]);
  });
});

describe("askable fields by role", () => {
  it.each<[Role, number]>([
    ["admin", 2],
    ["eboard", 14],
    ["general", 14],
  ])("%s can be shown %i inputs at an ordinary event", (role, n) => {
    const all = liveFields({
      user: { ...COMPLETE, role },
      event: { audience: "all" },
      config: { SEASON },
      editing: new Set<CoreFieldKey>([
        "firstName",
        "studentId",
        "phone",
        "personalEmail",
        "tshirtSize",
        "classification",
        "major",
        "majorOther",
        "duesPaid",
        "nationalMember",
        "house",
        "resume",
      ]),
    });
    expect(all.size).toBe(n);
  });
});

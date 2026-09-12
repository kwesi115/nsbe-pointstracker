/**
 * When a signup counts as finished, and where an unfinished one resumes.
 *
 * These are the rules the gate acts on, so they are tested as rules: pure
 * functions over a row, no database, no DOM. The database half —
 * that the backfill migration's SQL agrees with requiredSignupFieldsComplete
 * row for row, and that completeSignup refuses to latch early — lives in
 * repo.signup.test.ts.
 */

import { describe, expect, it } from "vitest";
import {
  missingSignupSteps,
  requiredSignupFieldsComplete,
  signupIsComplete,
  signupStepPosition,
  signupStepsFor,
  stepsFor,
  type SignupUser,
} from "./signup";

const SEASON = "2026-2027";

/** A member who has answered every required question — the "nothing left" baseline. */
const COMPLETE: SignupUser = {
  role: "general",
  firstName: "Ada",
  lastName: "Lovelace",
  studentId: "9001234",
  phone: "202-555-0100",
  personalEmail: "ada@example.com",
  tshirtSize: "M",
  classification: "junior",
  major: "Computer Engineering",
  majorOther: "",
  profileSeason: SEASON,
  duesPaidReported: true,
  nationalMemberReported: true,
  membershipSeason: SEASON,
  house: "House Turing",
  houseVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  resumeFileId: "file_1",
  signupCompletedAt: null,
};

function member(overrides: Partial<SignupUser> = {}): SignupUser {
  return { ...COMPLETE, ...overrides };
}

/** The state of an account the instant after the wizard's step 3 created it. */
const JUST_CREATED: SignupUser = member({
  phone: "",
  personalEmail: "",
  tshirtSize: "",
  duesPaidReported: null,
  nationalMemberReported: null,
  membershipSeason: "",
  house: "",
  houseVerifiedAt: null,
  resumeFileId: null,
});

describe("the resume point is derived from the data, never from a stored position", () => {
  it("a wizard abandoned right after the account step resumes at contact — step 4 of 7", () => {
    // The account step wrote name, student ID, classification and major, so
    // About is already answered and Contact is the first thing outstanding.
    const steps = missingSignupSteps(JUST_CREATED);
    expect(steps[0]).toBe("contact");
    expect(steps).toEqual(["contact", "membership", "house"]);
    expect(signupStepPosition("general", "contact")).toEqual({ position: 4, total: 7 });
  });

  it("a wizard abandoned after the House step resumes at resume — step 7 of 7, not step 1", () => {
    const afterHouse = member({ resumeFileId: null, signupCompletedAt: null });
    // Resume upload is optional, so nothing is REQUIRED any more...
    expect(requiredSignupFieldsComplete(afterHouse)).toBe(true);
    // ...and the position it would show is the last step, never the first.
    expect(signupStepPosition("general", "resume")).toEqual({ position: 7, total: 7 });
  });

  it("resumes at membership when only dues/national are outstanding", () => {
    const steps = missingSignupSteps(member({ duesPaidReported: null, nationalMemberReported: null }));
    expect(steps).toEqual(["membership"]);
    expect(signupStepPosition("general", "membership")).toEqual({ position: 5, total: 7 });
  });

  it("an admin-provisioned account — email and name only — resumes at About, because those fields really are missing", () => {
    const provisioned = member({
      studentId: "",
      classification: "",
      major: "",
      profileSeason: "",
      phone: "",
      personalEmail: "",
      duesPaidReported: null,
      nationalMemberReported: null,
      membershipSeason: "",
      house: "",
      houseVerifiedAt: null,
      resumeFileId: null,
    });
    expect(missingSignupSteps(provisioned)).toEqual(["about", "contact", "membership", "house"]);
    expect(signupStepPosition("general", "about")).toEqual({ position: 3, total: 7 });
  });

  it("re-deriving after each step shortens the list — which is the whole point of not storing an index", () => {
    let user = JUST_CREATED;
    expect(missingSignupSteps(user)).toEqual(["contact", "membership", "house"]);

    user = member({ ...user, phone: "202-555-0100", personalEmail: "ada@example.com" });
    expect(missingSignupSteps(user)).toEqual(["membership", "house"]);

    user = member({ ...user, duesPaidReported: false, nationalMemberReported: false });
    expect(missingSignupSteps(user)).toEqual(["house"]);

    user = member({ ...user, house: "House Turing" });
    expect(missingSignupSteps(user)).toEqual([]);
  });

  it("a field filled in elsewhere — by an admin, or at a check-in on another device — is not asked again", () => {
    // The case a stored step index gets wrong: the member never touched the
    // resume flow, but the data moved underneath it.
    const filledInByAdmin = member({ ...JUST_CREATED, phone: "202-555-0199", personalEmail: "a@b.c" });
    expect(missingSignupSteps(filledInByAdmin)).toEqual(["membership", "house"]);
  });
});

describe("progress is the real position in the wizard, not the position in what's left", () => {
  it("an E-Board member sees 7 steps: the join code adds one, and House is not asked of them", () => {
    expect(signupStepsFor("eboard")).toEqual([
      "type",
      "code",
      "account",
      "about",
      "contact",
      "membership",
      "resume",
    ]);
    expect(signupStepPosition("eboard", "contact")).toEqual({ position: 5, total: 7 });
  });

  it("a General member sees 7, because a codeless signup skips the code step", () => {
    expect(signupStepsFor("general")).toEqual(["type", "account", "about", "contact", "membership", "house", "resume"]);
  });

  it("numbering matches what the same member saw first time through the wizard", () => {
    expect(signupStepsFor("general")).toEqual(stepsFor("general", "general"));
    expect(signupStepsFor("eboard")).toEqual(stepsFor("eboard", "eboard"));
    expect(signupStepsFor("admin")).toEqual(stepsFor("admin", "admin"));
  });

  it("an admin's list stops at the account step", () => {
    expect(signupStepsFor("admin")).toEqual(["type", "code", "account"]);
  });
});

describe("complete means every REQUIRED step answered, not every field populated", () => {
  it("skipping the resume upload still counts as complete", () => {
    expect(requiredSignupFieldsComplete(member({ resumeFileId: null }))).toBe(true);
    expect(missingSignupSteps(member({ resumeFileId: null }))).toEqual([]);
  });

  it("a missing t-shirt size still counts as complete — it is optional on the Contact step", () => {
    expect(requiredSignupFieldsComplete(member({ tshirtSize: "" }))).toBe(true);
  });

  it("answering NO to dues and national is a complete answer, though check-in keeps asking", () => {
    const saidNo = member({ duesPaidReported: false, nationalMemberReported: false, membershipSeason: "" });
    expect(requiredSignupFieldsComplete(saidNo)).toBe(true);
    expect(missingSignupSteps(saidNo)).toEqual([]);
  });

  it("an unanswered dues/national question is NOT complete", () => {
    expect(requiredSignupFieldsComplete(member({ duesPaidReported: null }))).toBe(false);
    expect(requiredSignupFieldsComplete(member({ nationalMemberReported: null }))).toBe(false);
  });

  it("a stale season does not reopen a finished signup — no member is re-wizarded in August", () => {
    const lastSeason = member({ profileSeason: "2025-2026", membershipSeason: "2025-2026" });
    expect(requiredSignupFieldsComplete(lastSeason)).toBe(true);
    expect(missingSignupSteps(lastSeason)).toEqual([]);
  });

  it("every required field genuinely blocks: phone, personal email, student ID, classification, major, name", () => {
    for (const field of ["phone", "personalEmail", "studentId", "classification", "major", "firstName", "lastName"] as const) {
      expect(requiredSignupFieldsComplete(member({ [field]: "" }))).toBe(false);
    }
  });

  it('"Other" major needs the free-text field', () => {
    expect(requiredSignupFieldsComplete(member({ major: "Other", majorOther: "" }))).toBe(false);
    expect(requiredSignupFieldsComplete(member({ major: "Other", majorOther: "Ceramics" }))).toBe(true);
  });
});

describe("the House step: selecting a House and declining the test are both complete answers", () => {
  it("a selected House completes it", () => {
    expect(requiredSignupFieldsComplete(member({ house: "House Turing", houseVerifiedAt: null }))).toBe(true);
  });

  it("an already-verified House completes it even with no name on the row", () => {
    expect(requiredSignupFieldsComplete(member({ house: "", houseVerifiedAt: new Date() }))).toBe(true);
  });

  it("no House and no answer is NOT complete — it is the resume point", () => {
    const noHouse = member({ house: "", houseVerifiedAt: null });
    expect(requiredSignupFieldsComplete(noHouse)).toBe(false);
    expect(missingSignupSteps(noHouse)).toEqual(["house"]);
  });

  it('"I haven\'t taken the test yet" completes it, though it writes nothing to the row', () => {
    // The skip is why the latch exists: the row is indistinguishable from
    // "never answered", so the answer has to be carried by the caller.
    const skipped = member({ house: "", houseVerifiedAt: null });
    expect(requiredSignupFieldsComplete(skipped, { houseSkipped: true })).toBe(true);
    expect(missingSignupSteps(skipped, { houseSkipped: true })).toEqual([]);
  });
});

describe("role differences", () => {
  it("an EBOARD member answers what a GENERAL member answers, minus House", () => {
    const general = member({ ...JUST_CREATED, role: "general" });
    const officer = member({ ...JUST_CREATED, role: "eboard" });
    expect(missingSignupSteps(general)).toEqual(["contact", "membership", "house"]);
    expect(missingSignupSteps(officer)).toEqual(["contact", "membership"]);
  });

  it("an EBOARD member with no House is still complete — the question is not theirs to answer", () => {
    const officer = member({ role: "eboard", house: "", houseVerifiedAt: null });
    expect(requiredSignupFieldsComplete(officer)).toBe(true);
    expect(missingSignupSteps(officer)).toEqual([]);
  });

  it("an ADMIN account is complete as soon as it exists — no profile step can gate it", () => {
    // Including the shape the seed actually produces: a position for a first
    // name and a deliberately blank surname.
    const seeded = member({
      role: "admin",
      firstName: "President",
      lastName: "",
      studentId: "",
      classification: "",
      major: "",
      profileSeason: "",
      phone: "",
      personalEmail: "",
      tshirtSize: "",
      duesPaidReported: null,
      nationalMemberReported: null,
      membershipSeason: "",
      house: "",
      houseVerifiedAt: null,
      resumeFileId: null,
    });
    expect(missingSignupSteps(seeded)).toEqual([]);
    expect(requiredSignupFieldsComplete(seeded)).toBe(true);
    expect(signupIsComplete(seeded)).toBe(true);
  });
});

describe("the latch wins over the data, in both directions", () => {
  it("a latched account is complete even when the data no longer satisfies the predicate", () => {
    // How this happens in practice: someone finished by declining the House
    // test, or cleared their House later from /account. Neither makes them
    // mid-signup again.
    const latched = member({
      house: "",
      houseVerifiedAt: null,
      signupCompletedAt: new Date("2026-09-11T12:00:00Z"),
    });
    expect(requiredSignupFieldsComplete(latched)).toBe(false);
    expect(signupIsComplete(latched)).toBe(true);
  });

  it("an unlatched account that already satisfies the predicate is complete too — nobody is wizarded for nothing", () => {
    // The accounts the backfill catches, and any the backfill missed.
    expect(signupIsComplete(member({ signupCompletedAt: null }))).toBe(true);
  });

  it("an unlatched account with steps outstanding is mid-signup", () => {
    expect(signupIsComplete(JUST_CREATED)).toBe(false);
  });
});

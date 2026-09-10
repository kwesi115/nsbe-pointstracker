import { describe, expect, it } from "vitest";
import {
  getMissingFields,
  houseSelfVerifies,
  parseDescription,
  resolveDescription,
  validateCoreAnswers,
  validateReducedCoreAnswers,
  type CoreFieldKey,
  type CoreFormValidationContext,
  type GetMissingFieldsUser,
} from "./core-form";
import { AppError } from "./errors";
import type { House } from "./houses";
import type { Role } from "./types";

const SEASON = "2026-2027";

const TEST_HOUSES: House[] = [
  { code: "TURING", name: "House Turing", color: "#C8102E" },
  { code: "HAMILTON", name: "House Hamilton", color: "#F2A900" },
];

const COMPLETE_USER: GetMissingFieldsUser = {
  role: "general",
  firstName: "Ada",
  lastName: "Lovelace",
  studentId: "1000001",
  phone: "555-0100",
  personalEmail: "ada@example.com",
  classification: "senior",
  major: "Computer Science",
  majorOther: "",
  profileSeason: SEASON,
  duesPaidReported: true,
  nationalMemberReported: true,
  membershipSeason: SEASON,
  house: "House Turing",
  houseVerifiedAt: new Date("2026-01-01"),
  resumeFileId: "file_1",
};

const ALL_EVENT = { audience: "all" as const };
const EBOARD_EVENT = { audience: "eboard_only" as const };

function ctxFor(missing: CoreFieldKey[], role: Role = "general"): CoreFormValidationContext {
  return {
    role,
    majors: ["Computer Science", "Electrical Engineering"],
    houses: TEST_HOUSES,
    missing: new Set(missing),
  };
}

function omit<T extends Record<string, unknown>>(obj: T, key: keyof T): Partial<T> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

function validAnswers(overrides: Record<string, unknown> = {}) {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    studentId: "1000001",
    phone: "555-0100",
    personalEmail: "ada@example.com",
    classification: "sophomore",
    major: "Computer Science",
    duesPaid: true,
    nationalMember: true,
    nsbeMembershipId: "12345",
    ...overrides,
  };
}

describe("getMissingFields", () => {
  it("a member with a fully complete, current-season profile has nothing missing", () => {
    expect(getMissingFields(COMPLETE_USER, ALL_EVENT, { SEASON })).toEqual([]);
  });

  it("a brand-new profile is missing name, studentId, phone, personalEmail, classification, major, dues, national, house, and resume", () => {
    const fresh: GetMissingFieldsUser = {
      role: "general",
      firstName: "",
      lastName: "",
      studentId: "",
      phone: "",
      personalEmail: "",
      classification: "",
      major: "",
      majorOther: "",
      profileSeason: "",
      duesPaidReported: null,
      nationalMemberReported: null,
      membershipSeason: "",
      house: "",
      houseVerifiedAt: null,
      resumeFileId: null,
    };
    const missing = getMissingFields(fresh, ALL_EVENT, { SEASON });
    expect(missing).toEqual(
      expect.arrayContaining([
        "firstName",
        "lastName",
        "studentId",
        "phone",
        "personalEmail",
        "classification",
        "major",
        "duesPaid",
        "nationalMember",
        "house",
        "resume",
      ]),
    );
    // majorOther is never missing when major isn't "Other"; bisonEmail and
    // nsbeMembershipId are never members of the union at all.
    expect(missing).not.toContain("majorOther");
    expect(missing).not.toContain("nsbeMembershipId");
  });

  it("phone and personal email are required — missing only when blank, independent of everything else", () => {
    expect(getMissingFields(COMPLETE_USER, ALL_EVENT, { SEASON })).not.toContain("phone");
    expect(getMissingFields(COMPLETE_USER, ALL_EVENT, { SEASON })).not.toContain("personalEmail");
    expect(getMissingFields({ ...COMPLETE_USER, phone: "" }, ALL_EVENT, { SEASON })).toContain("phone");
    expect(getMissingFields({ ...COMPLETE_USER, personalEmail: "" }, ALL_EVENT, { SEASON })).toContain("personalEmail");
  });

  it("classification/major are asked once at the start of a new season, even though the value on file is still valid", () => {
    const staleSeason: GetMissingFieldsUser = { ...COMPLETE_USER, profileSeason: "2025-2026" };
    const missing = getMissingFields(staleSeason, ALL_EVENT, { SEASON });
    expect(missing).toContain("classification");
    expect(missing).toContain("major");
    // Nothing else is re-armed by a stale profileSeason — dues/national/house/resume are gated by their own stamps.
    expect(missing).not.toContain("duesPaid");
    expect(missing).not.toContain("house");
  });

  it("a current profileSeason means classification/major are never asked, even for a returning member", () => {
    const missing = getMissingFields(COMPLETE_USER, ALL_EVENT, { SEASON });
    expect(missing).not.toContain("classification");
    expect(missing).not.toContain("major");
  });

  it('major "Other" with no majorOther on file is missing, independent of profileSeason', () => {
    const other: GetMissingFieldsUser = { ...COMPLETE_USER, major: "Other", majorOther: "" };
    expect(getMissingFields(other, ALL_EVENT, { SEASON })).toContain("majorOther");
  });

  it("dues answered No still re-asks; answered Yes (this season) does not", () => {
    const answeredNo: GetMissingFieldsUser = { ...COMPLETE_USER, duesPaidReported: false, membershipSeason: SEASON };
    expect(getMissingFields(answeredNo, ALL_EVENT, { SEASON })).toContain("duesPaid");
    expect(getMissingFields(COMPLETE_USER, ALL_EVENT, { SEASON })).not.toContain("duesPaid");
  });

  it("a stale membershipSeason re-arms both dues and national, independent of profileSeason", () => {
    const staleMembership: GetMissingFieldsUser = { ...COMPLETE_USER, membershipSeason: "2020-2021" };
    const missing = getMissingFields(staleMembership, ALL_EVENT, { SEASON });
    expect(missing).toContain("duesPaid");
    expect(missing).toContain("nationalMember");
    expect(missing).not.toContain("classification");
  });

  it("a blank NSBE ID is never missing — an optional field must not put a form in front of a complete member", () => {
    // The one-tap check-in is exactly "getMissingFields came back empty"
    // (see CheckInFlow's skipForm), so an optional field can never be in
    // here. It is rendered on the check-in form, /join and /account
    // regardless — it just isn't a gap to fill.
    const nationalWithNoId: GetMissingFieldsUser = { ...COMPLETE_USER, nationalMemberReported: true };
    expect(getMissingFields(nationalWithNoId, ALL_EVENT, { SEASON })).toEqual([]);

    const notNationalWithNoId: GetMissingFieldsUser = {
      ...COMPLETE_USER,
      nationalMemberReported: false,
      membershipSeason: SEASON,
    };
    // Only the national question itself comes back — never the ID.
    expect(getMissingFields(notNationalWithNoId, ALL_EVENT, { SEASON })).toEqual(["nationalMember"]);
  });

  it("a member who skipped the House step at signup is asked again at check-in, and never again once house is set — even before admin verification", () => {
    const skipped: GetMissingFieldsUser = { ...COMPLETE_USER, house: "", houseVerifiedAt: null };
    expect(getMissingFields(skipped, ALL_EVENT, { SEASON })).toContain("house");

    const setButUnverified: GetMissingFieldsUser = { ...COMPLETE_USER, house: "House Turing", houseVerifiedAt: null };
    expect(getMissingFields(setButUnverified, ALL_EVENT, { SEASON })).not.toContain("house");
  });

  it("resume is missing only when nothing is on file at all", () => {
    expect(getMissingFields(COMPLETE_USER, ALL_EVENT, { SEASON })).not.toContain("resume");
    expect(getMissingFields({ ...COMPLETE_USER, resumeFileId: null }, ALL_EVENT, { SEASON })).toContain("resume");
  });

  it("bisonEmail is never returned — the account already proves it", () => {
    const fresh: GetMissingFieldsUser = { ...COMPLETE_USER, firstName: "", lastName: "" };
    const missing: string[] = getMissingFields(fresh, ALL_EVENT, { SEASON });
    expect(missing).not.toContain("bisonEmail");
  });

  it("an EBOARD_ONLY event asks nothing beyond genuinely-missing name fields", () => {
    expect(getMissingFields(COMPLETE_USER, EBOARD_EVENT, { SEASON })).toEqual([]);

    const freshOfficer: GetMissingFieldsUser = { ...COMPLETE_USER, firstName: "", classification: "", house: "" };
    expect(getMissingFields(freshOfficer, EBOARD_EVENT, { SEASON })).toEqual(["firstName"]);
  });

  it("an EBOARD member is prompted exactly like a GENERAL one on an ALL-audience event", () => {
    const gaps = { house: "", houseVerifiedAt: null, resumeFileId: null, duesPaidReported: null, membershipSeason: "" };
    const general: GetMissingFieldsUser = { ...COMPLETE_USER, ...gaps, role: "general" };
    const officer: GetMissingFieldsUser = { ...COMPLETE_USER, ...gaps, role: "eboard" };
    expect(getMissingFields(officer, ALL_EVENT, { SEASON })).toEqual(getMissingFields(general, ALL_EVENT, { SEASON }));
  });

  it("an EBOARD member with a missing House is prompted at their next check-in on an ALL-audience event", () => {
    const officer: GetMissingFieldsUser = { ...COMPLETE_USER, role: "eboard", house: "", houseVerifiedAt: null };
    expect(getMissingFields(officer, ALL_EVENT, { SEASON })).toContain("house");
  });

  it("the same EBOARD member is NOT prompted for their House on an EBOARD_ONLY event — audience, not role", () => {
    const officer: GetMissingFieldsUser = { ...COMPLETE_USER, role: "eboard", house: "", houseVerifiedAt: null };
    expect(getMissingFields(officer, EBOARD_EVENT, { SEASON })).not.toContain("house");
  });

  it("an ADMIN is never prompted to complete a member profile, on either audience", () => {
    const bareAdmin: GetMissingFieldsUser = {
      ...COMPLETE_USER,
      role: "admin",
      studentId: "",
      phone: "",
      personalEmail: "",
      classification: "",
      major: "",
      profileSeason: "",
      duesPaidReported: null,
      nationalMemberReported: null,
      membershipSeason: "",
      house: "",
      houseVerifiedAt: null,
      resumeFileId: null,
    };
    expect(getMissingFields(bareAdmin, ALL_EVENT, { SEASON })).toEqual([]);
    expect(getMissingFields(bareAdmin, EBOARD_EVENT, { SEASON })).toEqual([]);
  });

  it("the seven seeded ADMIN accounts are unaffected — never asked for a member profile, only for the last name the seed leaves blank", () => {
    // Shape of a prisma/seed.ts seedHardcodedAdmins row: firstName is the
    // officer's position, lastName is deliberately blank, and nothing else
    // on the member profile was ever filled in.
    const seededOfficer: GetMissingFieldsUser = {
      ...COMPLETE_USER,
      role: "admin",
      firstName: "President",
      lastName: "",
      studentId: "",
      phone: "",
      personalEmail: "",
      classification: "",
      major: "",
      profileSeason: "",
      duesPaidReported: null,
      nationalMemberReported: null,
      membershipSeason: "",
      house: "",
      houseVerifiedAt: null,
      resumeFileId: null,
    };
    // lastName is the one thing still asked — it's the only field
    // buildCoreFormSchema requires unconditionally, so it must stay in sync.
    expect(getMissingFields(seededOfficer, ALL_EVENT, { SEASON })).toEqual(["lastName"]);
  });
});

describe("houseSelfVerifies — the one House role rule", () => {
  it("is true for EBOARD only", () => {
    expect(houseSelfVerifies("eboard")).toBe(true);
    expect(houseSelfVerifies("general")).toBe(false);
    expect(houseSelfVerifies("admin")).toBe(false);
    expect(houseSelfVerifies("guest")).toBe(false);
  });
});

describe("validateCoreAnswers", () => {
  it("classification/major aren't required when getMissingFields didn't ask for them", () => {
    const ctx = ctxFor([]);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "classification"))).not.toThrow();
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "major"))).not.toThrow();
  });

  it("classification/major ARE required when getMissingFields asked for them", () => {
    const ctx = ctxFor(["classification", "major"]);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "classification"))).toThrow(AppError);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "major"))).toThrow(AppError);
  });

  it("Other on major requires the free-text field, regardless of whether major itself was asked", () => {
    const ctx = ctxFor(["classification", "major"]);
    expect(() => validateCoreAnswers(ctx, validAnswers({ major: "Other" }))).toThrow(AppError);
    try {
      validateCoreAnswers(ctx, validAnswers({ major: "Other" }));
    } catch (err) {
      expect((err as AppError).fieldErrors).toMatchObject({ majorOther: expect.any(String) });
    }
    const result = validateCoreAnswers(ctx, validAnswers({ major: "Other", majorOther: "Undeclared" }));
    expect(result.majorOther).toBe("Undeclared");
  });

  it("a majorOther-only submission (major already 'Other' on file, not re-asked) survives untouched", () => {
    const ctx = ctxFor(["majorOther"]);
    const result = validateCoreAnswers(ctx, omit(validAnswers({ majorOther: "Undeclared" }), "major"));
    expect(result.major).toBeUndefined();
    expect(result.majorOther).toBe("Undeclared");
  });

  it("National = No does NOT clear a submitted nsbeMembershipId — the two are independent", () => {
    const ctx = ctxFor(["nationalMember"]);
    const result = validateCoreAnswers(ctx, validAnswers({ nationalMember: false, nsbeMembershipId: "99999" }));
    expect(result.nsbeMembershipId).toBe("99999");
  });

  it("an nsbeMembershipId survives on its own with the national question unanswered and unasked", () => {
    const result = validateCoreAnswers(ctxFor([]), omit(validAnswers({ nsbeMembershipId: "55555" }), "nationalMember"));
    expect(result.nationalMember).toBeUndefined();
    expect(result.nsbeMembershipId).toBe("55555");
  });

  it("a blank nsbeMembershipId is accepted on every national answer — Yes, No, and unanswered", () => {
    for (const nationalMember of [true, false, undefined]) {
      const answers = validAnswers({ nsbeMembershipId: "" });
      if (nationalMember === undefined) delete (answers as Record<string, unknown>).nationalMember;
      else answers.nationalMember = nationalMember;

      const result = validateCoreAnswers(ctxFor([]), answers);
      expect(result.nsbeMembershipId).toBe("");
    }
  });

  it("dropdown and yes/no questions are never satisfied by omission when getMissingFields asked for them — no server-side preselect exists", () => {
    const ctx = ctxFor(["classification", "duesPaid"]);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "classification"))).toThrow(AppError);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "duesPaid"))).toThrow(AppError);
  });

  it("a member who already reported dues this season isn't re-asked — duesPaid can be omitted", () => {
    const alreadyReportedCtx = ctxFor([]);
    expect(() => validateCoreAnswers(alreadyReportedCtx, omit(validAnswers(), "duesPaid"))).not.toThrow();
    expect(() => validateCoreAnswers(ctxFor(["duesPaid"]), omit(validAnswers(), "duesPaid"))).toThrow(AppError);
  });

  it("a member who already reported national membership this season isn't re-asked — nationalMember can be omitted", () => {
    expect(() => validateCoreAnswers(ctxFor([]), omit(validAnswers(), "nationalMember"))).not.toThrow();
    expect(() => validateCoreAnswers(ctxFor(["nationalMember"]), omit(validAnswers(), "nationalMember"))).toThrow(AppError);
  });

  it("a verified (or merely set) House is never re-asked — no House fields are required once house isn't in the missing set", () => {
    expect(() => validateCoreAnswers(ctxFor([]), validAnswers())).not.toThrow();
  });

  it("no Yes/No question — a House selection without a screenshot is rejected", () => {
    const ctx = ctxFor(["house"]);
    expect(() => validateCoreAnswers(ctx, validAnswers({ house: "House Turing" }))).toThrow(AppError);
    try {
      validateCoreAnswers(ctx, validAnswers({ house: "House Turing" }));
    } catch (err) {
      expect((err as AppError).fieldErrors).toMatchObject({ houseProofFileId: expect.any(String) });
    }
  });

  it("a screenshot without a House selection is rejected", () => {
    const ctx = ctxFor(["house"]);
    expect(() => validateCoreAnswers(ctx, validAnswers({ houseProofFileId: "file_1" }))).toThrow(AppError);
    try {
      validateCoreAnswers(ctx, validAnswers({ houseProofFileId: "file_1" }));
    } catch (err) {
      expect((err as AppError).fieldErrors).toMatchObject({ house: expect.any(String) });
    }
  });

  it("a House and its screenshot together are accepted", () => {
    const ctx = ctxFor(["house"]);
    expect(() =>
      validateCoreAnswers(ctx, validAnswers({ house: "House Turing", houseProofFileId: "file_1" })),
    ).not.toThrow();
  });

  it("an explicit skip is a complete, valid answer on its own, even while House is missing", () => {
    const ctx = ctxFor(["house"]);
    expect(() => validateCoreAnswers(ctx, validAnswers({ houseSkipped: true }))).not.toThrow();
  });

  it("an EBOARD member's House is accepted with no screenshot; a GENERAL member's is not", () => {
    const answers = validAnswers({ house: "House Turing" });
    expect(() => validateCoreAnswers(ctxFor(["house"], "eboard"), answers)).not.toThrow();
    expect(() => validateCoreAnswers(ctxFor(["house"], "general"), answers)).toThrow(AppError);
  });

  it("the House itself is still required of an EBOARD member — only the upload requirement is dropped", () => {
    expect(() => validateCoreAnswers(ctxFor(["house"], "eboard"), validAnswers())).toThrow(AppError);
    expect(() => validateCoreAnswers(ctxFor(["house"], "eboard"), validAnswers({ houseSkipped: true }))).not.toThrow();
  });

  it("an unknown House name is rejected for EBOARD too — no upload is not no validation", () => {
    expect(() => validateCoreAnswers(ctxFor(["house"], "eboard"), validAnswers({ house: "House Nope" }))).toThrow(
      AppError,
    );
  });

  it("studentId/phone/personalEmail ARE required when getMissingFields asked for them", () => {
    const ctx = ctxFor(["studentId", "phone", "personalEmail"]);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "studentId"))).toThrow(AppError);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "phone"))).toThrow(AppError);
    expect(() => validateCoreAnswers(ctx, omit(validAnswers(), "personalEmail"))).toThrow(AppError);
  });

  it("an ADMIN check-in — nothing asked, so only the name is required and nothing else is invented", () => {
    const result = validateCoreAnswers(ctxFor([]), { firstName: "Ada", lastName: "Lovelace" });
    expect(result.studentId).toBeUndefined();
    expect(result.phone).toBeUndefined();
    expect(result.personalEmail).toBeUndefined();
  });

  it("a name is required no matter what getMissingFields asked for", () => {
    expect(() => validateCoreAnswers(ctxFor([]), omit(validAnswers(), "firstName"))).toThrow(AppError);
    expect(() => validateCoreAnswers(ctxFor([]), validAnswers({ lastName: "" }))).toThrow(AppError);
  });

  it("a resume on file: Keep requires no upload, Update requires one", () => {
    const withResumeCtx = ctxFor([]);
    expect(() => validateCoreAnswers(withResumeCtx, validAnswers({ resumeAction: "keep" }))).not.toThrow();
    expect(() => validateCoreAnswers(withResumeCtx, validAnswers({ resumeAction: "upload" }))).toThrow(AppError);
    expect(() =>
      validateCoreAnswers(withResumeCtx, validAnswers({ resumeAction: "upload", resumeFileId: "file_2" })),
    ).not.toThrow();
  });
});

describe("validateReducedCoreAnswers — EBOARD_ONLY events (Part 6)", () => {
  it("accepts just firstName/lastName", () => {
    const result = validateReducedCoreAnswers({ firstName: "Ada", lastName: "Lovelace" });
    expect(result).toEqual({ firstName: "Ada", lastName: "Lovelace" });
  });

  it("rejects a missing name", () => {
    expect(() => validateReducedCoreAnswers({ firstName: "Ada" })).toThrow(AppError);
    expect(() => validateReducedCoreAnswers({})).toThrow(AppError);
  });

  it("rejects full-form fields — the reduced form has no dues/national/House/resume/classification/major/studentId at all", () => {
    expect(() =>
      validateReducedCoreAnswers({ firstName: "Ada", lastName: "Lovelace", studentId: "12345", duesPaid: true }),
    ).toThrow(AppError);
  });
});

describe("description parsing", () => {
  it("resolves {{token}} placeholders and extracts [label](url) as a real link", () => {
    const resolved = resolveDescription("Pay via [the site]({{membershipSiteUrl}}).", {
      membershipSiteUrl: "https://example.org/dues",
    });
    const parts = parseDescription(resolved);
    expect(parts).toContainEqual({ type: "link", text: "the site", href: "https://example.org/dues" });
  });
});

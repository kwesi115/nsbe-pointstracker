/**
 * The static core check-in form — a versioned, typed constant. This is the
 * ONLY place any core question's copy, section, requiredness, or
 * options-source is defined; no component hardcodes a core question's label
 * or description. NOT stored in the database (see prisma/schema.prisma —
 * FormField is extra-questions-only now). Answers write back to the User
 * record (see repo.ts registerForEvent); Registration only keeps a small
 * audit snapshot (classificationAtTime, majorAtTime, ...).
 *
 * Bump CORE_FORM_VERSION whenever this constant's questions change, and it
 * gets stamped on every Registration so old rows stay interpretable.
 */

import { z } from "zod";
import { AppError } from "./errors";
import type { House } from "./houses";
import type { Audience, Classification, Member, Role } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CORE_FORM_VERSION = 2;

export type CoreFormSection = "info" | "membership" | "house_resume";

export const CORE_FORM_SECTIONS: Record<CoreFormSection, string> = {
  info: "Your info",
  membership: "Membership",
  house_resume: "House & resume",
};

/** A `[label](url)` run inside a field's description becomes a real anchor; everything else is plain body text. */
export type DescriptionPart = { type: "text"; text: string } | { type: "link"; text: string; href: string };

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;

/** Substitutes `{{configKey}}` tokens (see MEMBERSHIP_SITE_URL/HOUSE_TEST_URL in a description's link target) with real Config values before parsing. */
export function resolveDescription(description: string, vars: Record<string, string>): string {
  return description.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "#");
}

export function parseDescription(description: string): DescriptionPart[] {
  const parts: DescriptionPart[] = [];
  let lastIndex = 0;
  for (const match of description.matchAll(LINK_PATTERN)) {
    const [full, text, href] = match;
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ type: "text", text: description.slice(lastIndex, index) });
    parts.push({ type: "link", text, href });
    lastIndex = index + full.length;
  }
  if (lastIndex < description.length) parts.push({ type: "text", text: description.slice(lastIndex) });
  return parts;
}

export const CLASSIFICATION_OPTIONS: Array<{ value: Classification; label: string }> = [
  { value: "freshman", label: "Freshman" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
  { value: "graduate", label: "Graduate Student" },
];

export const OTHER_MAJOR = "Other";

export type CoreFieldKind = "short_text" | "email" | "dropdown" | "yes_no" | "file_upload" | "choice";

export interface CoreFormField {
  id: string;
  label: string;
  section: CoreFormSection;
  kind: CoreFieldKind;
  required: boolean;
  description?: string;
  /** Short-answer prefill only (Part 3) — never applies to a dropdown/choice question. */
  prefillFrom?: keyof Member;
  readOnly?: boolean;
  helpText?: string;
}

/**
 * Every question a member can see, in order. Conditional visibility (major
 * "Other", national member id, the whole House/Resume blocks) is decided by
 * the rendering component and by buildCoreFormSchema below — this array is
 * the source of truth for copy/required/section only.
 */
export const CORE_FORM_FIELDS: CoreFormField[] = [
  { id: "firstName", label: "First name", section: "info", kind: "short_text", required: true, prefillFrom: "firstName" },
  { id: "lastName", label: "Last name", section: "info", kind: "short_text", required: true, prefillFrom: "lastName" },
  {
    id: "bisonEmail",
    label: "Bison email",
    section: "info",
    kind: "email",
    required: true,
    readOnly: true,
    helpText: "Your account already proves this address.",
  },
  { id: "studentId", label: "Student ID", section: "info", kind: "short_text", required: true, prefillFrom: "studentId" },
  { id: "phone", label: "Phone", section: "info", kind: "short_text", required: true, prefillFrom: "phone" },
  {
    id: "personalEmail",
    label: "Personal email",
    section: "info",
    kind: "email",
    required: true,
    prefillFrom: "personalEmail",
    helpText: "A non-Howard email so we can reach you after graduation. Not used for sign-in.",
  },
  {
    id: "classification",
    label: "Classification",
    section: "info",
    kind: "dropdown",
    required: true,
  },
  {
    id: "major",
    label: "Major",
    section: "info",
    kind: "dropdown",
    required: true,
  },
  {
    id: "majorOther",
    label: "Your major",
    section: "info",
    kind: "short_text",
    required: true,
  },
  {
    id: "duesPaid",
    label: "Have you paid your chapter dues?",
    section: "membership",
    kind: "yes_no",
    required: true,
    description:
      "If no, please pay your 2026–2027 chapter dues through the [Howard NSBE Membership Website]({{membershipSiteUrl}}).\nIMPORTANT! Make sure to put your full name with your payment to confirm your identity.",
  },
  {
    id: "nationalMember",
    label: "Are you a National NSBE member?",
    section: "membership",
    kind: "yes_no",
    required: true,
    description: "Not a member yet? Join or renew at [NSBE.org]({{nationalMembershipUrl}}).",
  },
  {
    // Independent of the national membership answer: always shown, always
    // optional, never revealed by a Yes. A member can hold an ID from a
    // prior year, or have one pending, while answering No this season.
    id: "nsbeMembershipId",
    label: "NSBE Membership ID",
    section: "membership",
    kind: "short_text",
    required: false,
    prefillFrom: "nsbeMembershipId",
    helpText: "Optional. Leave blank if you don't have one yet.",
  },
  {
    id: "house",
    label: "NSBE House",
    section: "house_resume",
    kind: "dropdown",
    required: true,
  },
  {
    id: "houseProofFileId",
    label: "Upload a screenshot of your NSBE House Personality Test result.",
    section: "house_resume",
    kind: "file_upload",
    required: true,
  },
  {
    id: "resumeAction",
    label: "Resume on file",
    section: "house_resume",
    kind: "choice",
    required: false,
  },
  {
    id: "resumeFileId",
    label: "Upload Your Resume (Optional)",
    section: "house_resume",
    kind: "file_upload",
    required: false,
    description:
      "Upload your most current resume for professional development, corporate, and recruiting opportunities. By uploading your resume, you consent to Howard NSBE sharing it with employers for recruiting and professional opportunities.",
  },
];

/**
 * THE role rule for the NSBE House, defined once and consulted everywhere:
 * HouseBlock.tsx (what to render), joinWizardRules.ts validateHouseStep and
 * buildCoreFormSchema below (what to require), and lib/repo.ts
 * setHouseAssignment/registerForEvent (what to write). No surface re-derives
 * it from a role comparison of its own.
 *
 * An E-Board member picks a House from the dropdown with no screenshot, and
 * it is verified at the moment of selection — officers are known to the
 * chapter, so there is nobody for them to prove it to. Everyone else uploads
 * proof and stays pending until an admin reviews it.
 *
 * Self-verification happens ONLY at selection time. Promoting a GENERAL
 * member who already has a pending House does not retroactively verify it —
 * setMemberRole touches `role` and nothing else, and the screenshot they
 * already uploaded still gets reviewed.
 */
export function houseSelfVerifies(role: Role): boolean {
  return role === "eboard";
}

export function coreField(id: string): CoreFormField {
  const field = CORE_FORM_FIELDS.find((f) => f.id === id);
  if (!field) throw new Error(`Unknown core form field: ${id}`);
  return field;
}

// ---------------------------------------------------------------------------
// Gap-filler — the check-in form's entire "what do we still need to ask"
// rule lives here, and nowhere else. A field renders only if its value is
// missing, stale, or answered No; everything already on the account is not
// shown as a question at all. buildCoreFormSchema/validateCoreAnswers below
// and CoreCheckInForm.tsx both drive off this same function so there is
// exactly one implementation of "what's missing" to keep in sync.
// ---------------------------------------------------------------------------

/**
 * Every field the check-in form (or /account's completeness panel) can ever
 * ask about. Two fields are deliberately NOT members of this union:
 * bisonEmail, because the account already proves it; and nsbeMembershipId,
 * because it is optional. CheckInFlow gives a one-tap check-in exactly when
 * getMissingFields comes back empty, so an optional field listed here would
 * put a whole form in front of a member who has nothing left to answer. It
 * is rendered on the check-in form, /join and /account regardless — it just
 * never counts as "missing".
 */
export type CoreFieldKey =
  | "firstName"
  | "lastName"
  | "studentId"
  | "phone"
  | "personalEmail"
  | "classification"
  | "major"
  | "majorOther"
  | "duesPaid"
  | "nationalMember"
  | "house"
  | "resume";

export interface GetMissingFieldsUser {
  /**
   * The CURRENT roster role. Only ADMIN changes anything here — see
   * getMissingFields. An EBOARD member is prompted exactly like a GENERAL
   * one, because an officer is a student with a House, a shirt size, dues
   * and a national membership just like every other member.
   */
  role: Role;
  firstName: string;
  lastName: string;
  studentId: string;
  phone: string;
  personalEmail: string;
  classification: Classification | "";
  major: string;
  majorOther: string;
  /** The season classification/major were last confirmed for — see User.profileSeason. */
  profileSeason: string;
  duesPaidReported: boolean | null;
  nationalMemberReported: boolean | null;
  /** The season dues/national were last confirmed for — see User.membershipSeason. */
  membershipSeason: string;
  house: string;
  houseVerifiedAt: Date | null;
  resumeFileId: string | null;
}

export interface GetMissingFieldsConfig {
  SEASON: string;
}

/**
 * The check-in form's ONE source of truth for what to ask. Pure and
 * side-effect free — lib/repo.ts registerForEvent uses it to decide what the
 * server requires, CoreCheckInForm.tsx uses it to decide what to render, and
 * /account's completeness panel uses it to decide what to list. Two
 * implementations of "what's missing" would drift; this is the only one.
 *
 * Two independent reductions stop after the name fields, and they must stay
 * two separate checks — collapsing them would break one case each way:
 *
 *   WHO YOU ARE          ADMIN accounts are a staff login, not a member
 *                        profile — they never signed up for one (see
 *                        joinWizardRules.ts stepsFor) and are never nagged
 *                        to complete one. EBOARD is NOT included: an
 *                        officer is prompted exactly like a GENERAL member.
 *
 *   WHAT EVENT YOU'RE AT EBOARD_ONLY events only ever ask for
 *                        genuinely-missing name fields — officers
 *                        re-confirming dues/House/resume at every weekly
 *                        meeting is how a form gets abandoned. This applies
 *                        to whoever is in the room, whatever their role.
 *
 * Name is the floor for both, not zero, because firstName/lastName are the
 * only fields buildCoreFormSchema requires unconditionally — anything this
 * function stops asking for, that schema must also stop requiring, or a
 * check-in fails on a question that was never rendered.
 */
export function getMissingFields(
  user: GetMissingFieldsUser,
  event: { audience: Audience },
  config: GetMissingFieldsConfig,
): CoreFieldKey[] {
  const missing: CoreFieldKey[] = [];

  if (!user.firstName) missing.push("firstName");
  if (!user.lastName) missing.push("lastName");

  if (user.role === "admin") return missing;

  if (event.audience === "eboard_only") return missing;

  if (!user.studentId) missing.push("studentId");
  if (!user.phone) missing.push("phone");
  if (!user.personalEmail) missing.push("personalEmail");

  const profileStale = user.profileSeason !== config.SEASON;
  if (!user.classification || profileStale) missing.push("classification");
  if (!user.major || profileStale) missing.push("major");
  if (user.major === OTHER_MAJOR && !user.majorOther) missing.push("majorOther");

  if (user.duesPaidReported !== true || user.membershipSeason !== config.SEASON) missing.push("duesPaid");
  if (user.nationalMemberReported !== true || user.membershipSeason !== config.SEASON) missing.push("nationalMember");

  if (user.houseVerifiedAt === null && !user.house) missing.push("house");

  if (user.resumeFileId === null) missing.push("resume");

  return missing;
}

// ---------------------------------------------------------------------------
// Validation — mirrors lib/forms.ts's buildFormSchema/validateAnswers shape.
// ---------------------------------------------------------------------------

export interface CoreFormAnswers {
  firstName: string;
  lastName: string;
  /** Omitted entirely when the form didn't ask — an ADMIN is never asked for any of these; see getMissingFields. */
  studentId?: string;
  phone?: string;
  personalEmail?: string;
  /** Omitted entirely once already current for this season — see profileStale in getMissingFields. */
  classification?: Classification;
  major?: string;
  majorOther?: string;
  /** Omitted entirely once already reported this season — see duesAlreadyReported below. */
  duesPaid?: boolean;
  nationalMember?: boolean;
  /** Always offered, always optional, never gated on `nationalMember`. Absent means "not submitted"; "" means the member cleared it. */
  nsbeMembershipId?: string;
  house?: string;
  houseProofFileId?: string;
  /** Explicit "I haven't taken the test yet" — a complete, valid answer on its own; see buildCoreFormSchema's house superRefine below. */
  houseSkipped?: boolean;
  resumeAction?: "keep" | "upload";
  resumeFileId?: string;
}

export interface CoreFormValidationContext {
  /** The CURRENT roster role — only consulted through houseSelfVerifies. */
  role: Role;
  majors: string[];
  houses: House[];
  /** What getMissingFields decided to ask this member — the ONLY thing that decides which fields are required below. */
  missing: Set<CoreFieldKey>;
}

export function buildCoreFormSchema(ctx: CoreFormValidationContext) {
  const classificationValues = CLASSIFICATION_OPTIONS.map((o) => o.value) as [Classification, ...Classification[]];
  const majorOptions: string[] = [...ctx.majors, OTHER_MAJOR];
  const majorValues = majorOptions as [string, ...string[]];
  const missing = ctx.missing;

  return z
    .object({
      // The only two fields required unconditionally — every core form, full
      // or reduced, confirms identity, and getMissingFields never stops
      // asking for a blank name whatever the role or audience.
      firstName: z.string().trim().min(1, "Required").max(200),
      lastName: z.string().trim().min(1, "Required").max(200),
      // studentId/phone/personalEmail are still required of every member —
      // but "required" means "required WHEN ASKED", exactly like
      // classification/major below. An ADMIN never gave them (their signup
      // stops after the account step) and is never asked for them, so a
      // hard requirement here would fail their check-in on questions the
      // form didn't render. A member who has them on file always submits
      // them back, so this is a no-op for GENERAL and EBOARD.
      studentId: z.string().trim().min(1, "Required").max(50).optional(),
      phone: z.string().trim().min(1, "Required").max(50).optional(),
      personalEmail: z
        .string()
        .trim()
        .min(1, "Required")
        .max(200)
        .refine((v) => EMAIL_PATTERN.test(v), "Enter a valid email")
        .optional(),
      // classification/major/majorOther are only ever in the missing set when
      // stale or absent (see getMissingFields) — an already-current value is
      // never resubmitted, so these can't be unconditionally required.
      classification: z.enum(classificationValues, "Select a classification").optional(),
      major: z.enum(majorValues, "Select a major").optional(),
      majorOther: z.string().trim().max(200).optional(),
      duesPaid: z.boolean().optional(),
      nationalMember: z.boolean().optional(),
      nsbeMembershipId: z.string().trim().max(50).optional(),
      house: z.string().trim().optional(),
      houseProofFileId: z.string().trim().optional(),
      houseSkipped: z.boolean().optional(),
      resumeAction: z.enum(["keep", "upload"]).optional(),
      resumeFileId: z.string().trim().optional(),
    })
    .strict()
    .superRefine((data, ctxRefine) => {
      for (const key of ["studentId", "phone", "personalEmail"] as const) {
        if (missing.has(key) && data[key] === undefined) {
          ctxRefine.addIssue({ code: "custom", path: [key], message: "Required" });
        }
      }

      if (missing.has("classification") && data.classification === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["classification"], message: "Select a classification" });
      }
      if (missing.has("major") && data.major === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["major"], message: "Select a major" });
      }
      if (data.major === OTHER_MAJOR && !data.majorOther?.trim()) {
        ctxRefine.addIssue({ code: "custom", path: ["majorOther"], message: "Tell us your major" });
      }

      if (missing.has("duesPaid") && data.duesPaid === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["duesPaid"], message: "Required" });
      }
      if (missing.has("nationalMember") && data.nationalMember === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["nationalMember"], message: "Required" });
      }

      // No more Yes/No question — an explicit skip is a complete, valid
      // answer on its own (house stays null). Otherwise a House and its
      // screenshot are required TOGETHER: one without the other is unusable
      // (an unverifiable House, or an orphaned screenshot). An E-Board
      // member has no screenshot to pair it with, so the House alone is the
      // complete answer for them — see houseSelfVerifies.
      if (missing.has("house") && !data.houseSkipped) {
        if (!data.house || !ctx.houses.some((h) => h.name === data.house)) {
          ctxRefine.addIssue({ code: "custom", path: ["house"], message: "Select your House" });
        }
        if (!houseSelfVerifies(ctx.role) && !data.houseProofFileId) {
          ctxRefine.addIssue({ code: "custom", path: ["houseProofFileId"], message: "Upload your House test result" });
        }
      }

      // resumeAction ("keep" vs "upload") only makes sense once there's an
      // existing resume to keep — !missing.has("resume") is exactly that.
      if (!missing.has("resume") && data.resumeAction === "upload" && !data.resumeFileId) {
        ctxRefine.addIssue({ code: "custom", path: ["resumeFileId"], message: "Upload your updated resume" });
      }
    });
}

/** Validates and narrows raw core-form answers, same AppError shape as lib/forms.ts validateAnswers. */
export function validateCoreAnswers(ctx: CoreFormValidationContext, answers: unknown): CoreFormAnswers {
  const schema = buildCoreFormSchema(ctx);
  const result = schema.safeParse(answers);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fieldErrors });
  }
  const data = result.data as CoreFormAnswers;
  // nsbeMembershipId is NOT derived from the national membership answer —
  // answering No leaves whatever the member typed exactly as they typed it.
  // The only thing that clears it is the member clearing the field.
  // Same reasoning: major is only in the payload when it was asked. If it
  // wasn't (already current), a majorOther submitted on its own — the
  // gap-filler case where major="Other" already but majorOther was empty —
  // must survive untouched.
  if (data.major !== undefined && data.major !== OTHER_MAJOR) data.majorOther = undefined;
  return data;
}

// ---------------------------------------------------------------------------
// Reduced core form — EBOARD_ONLY events (Part 6). Officers answering the
// full form's dues/national/House/resume questions at every weekly meeting is
// how a form gets abandoned; this variant is just enough to confirm identity.
// ---------------------------------------------------------------------------

const REDUCED_SCHEMA = z
  .object({
    firstName: z.string().trim().min(1, "Required").max(200),
    lastName: z.string().trim().min(1, "Required").max(200),
  })
  .strict();

export type ReducedCoreFormAnswers = z.infer<typeof REDUCED_SCHEMA>;

/** Validates the reduced form — same AppError shape as validateCoreAnswers, deliberately no other fields accepted. */
export function validateReducedCoreAnswers(answers: unknown): ReducedCoreFormAnswers {
  const result = REDUCED_SCHEMA.safeParse(answers);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
    }
    throw new AppError("VALIDATION_FAILED", "Check the highlighted fields.", { fieldErrors });
  }
  return result.data;
}

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
import type { Audience, Classification, Member, Role, ShirtSize } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const CORE_FORM_VERSION = 3;

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

/**
 * The seven sizes, smallest first — the ONE list every surface renders from
 * (JoinWizard, /account, /admin/members/[id], the roster column and filter,
 * and the roster's size breakdown). Order matters: the breakdown reports in
 * this order, and "23 M, 31 L, 18 XL" is only readable if the sizes come out
 * in size order rather than alphabetically or by count.
 */
export const SHIRT_SIZE_OPTIONS: ShirtSize[] = ["S", "M", "L", "XL"];

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
  /** Shown in the empty input. Illustrates the expected shape; never validated against. */
  placeholder?: string;
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
  {
    id: "studentId",
    label: "Student ID",
    section: "info",
    kind: "short_text",
    required: true,
    prefillFrom: "studentId",
    // Guidance, deliberately NOT a rule: buildCoreFormSchema below validates
    // studentId as a non-empty string and nothing more. A hard "starts with 00"
    // check would lock out anyone whose ID legitimately differs — a transfer,
    // an exchange student, an older record — and a member who cannot check in is
    // a worse outcome than a mistyped digit an admin can fix.
    helpText: "Starts with 00",
    placeholder: "00XXXXXX",
  },
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
    id: "tshirtSize",
    label: "T-shirt size",
    section: "info",
    kind: "dropdown",
    required: true,
    helpText: "Used for chapter apparel orders. You can change this any time from your account.",
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
  | "tshirtSize"
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
  tshirtSize: ShirtSize | "";
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
 *                        lib/signup.ts stepsFor) and are never nagged to
 *                        complete one. EBOARD still answers everything a
 *                        GENERAL member does EXCEPT House, which their signup
 *                        skips entirely, so nothing here may ask for it.
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
  // Not seasonal: unlike classification/major, a shirt size doesn't go stale,
  // so this is asked exactly once and then never again. That is what makes it
  // safe to add to an existing roster — a member who already has one on file
  // sees no new question.
  if (!user.tshirtSize) missing.push("tshirtSize");

  const profileStale = user.profileSeason !== config.SEASON;
  if (!user.classification || profileStale) missing.push("classification");
  if (!user.major || profileStale) missing.push("major");
  if (user.major === OTHER_MAJOR && !user.majorOther) missing.push("majorOther");

  if (user.duesPaidReported !== true || user.membershipSeason !== config.SEASON) missing.push("duesPaid");
  if (user.nationalMemberReported !== true || user.membershipSeason !== config.SEASON) missing.push("nationalMember");

  // House is a GENERAL-member question only. An E-Board account no longer
  // answers it at signup (see lib/signup.ts stepsFor), so asking for it at
  // check-in would re-open a question their signup deliberately skipped — and
  // there would be no way to answer it, since the House step no longer exists
  // in their flow. It stays available as an optional field on /account for an
  // officer who wants their House on record.
  if (user.role === "general" && user.houseVerifiedAt === null && !user.house) missing.push("house");

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
  tshirtSize?: ShirtSize;
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
      tshirtSize: z.enum(SHIRT_SIZE_OPTIONS as [ShirtSize, ...ShirtSize[]], "Select a size").optional(),
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

      if (missing.has("tshirtSize") && data.tshirtSize === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["tshirtSize"], message: "Select a size" });
      }

      if (missing.has("classification") && data.classification === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["classification"], message: "Select a classification" });
      }
      if (missing.has("major") && data.major === undefined) {
        ctxRefine.addIssue({ code: "custom", path: ["major"], message: "Select a major" });
      }
      // Two ways to owe a majorOther: picking "Other" now, or having "Other"
      // on file with nothing beside it (getMissingFields asks for it alone).
      const owesMajorOther = data.major === OTHER_MAJOR || (missing.has("majorOther") && data.major === undefined);
      if (owesMajorOther && !data.majorOther?.trim()) {
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
// The submit plan — what one check-in submission is validated against.
//
// getMissingFields decides what the form ASKS. That used to be only half of
// the contract: the client also sent back values it never rendered (seeded
// from the stored profile — a major, a personal email, a blank student ID),
// and the schema above format-checked whatever arrived. A stored value the
// schema dislikes — a free-text major written by an earlier "Other" check-in,
// a major since removed from MAJORS_LIST, a personal email saved on /account
// without the email check — then failed a check-in on a field the member was
// never shown, usually on the one-tap screen with no fields at all.
//
// planCheckIn closes that. Computed server-side at submit, for that user and
// that event, from the same getMissingFields the form rendered from:
//
//   accepted  what the member was shown AND actually answered. Anything else
//             in the payload is dropped before validation — never checked,
//             never written. That includes a stale value echoed from a page
//             loaded before the profile changed in another tab, which would
//             otherwise overwrite the newer value.
//   required  what getMissingFields says is missing AND the member was shown.
//   requiredButNotRendered
//             missing, but NOT shown — the profile changed between page load
//             and submit (a SEASON bump, an admin revoking dues or rejecting a
//             House, a role change). Not the member's error: it's dropped from
//             `required` so the check-in goes through, the caller logs it, and
//             getMissingFields asks for it at the next check-in.
//
// The reduced EBOARD_ONLY form is not a second schema any more: getMissingFields
// already stops at the name fields for it, and askableFields below says the
// same thing about what the form can render, so one path validates both.
// ---------------------------------------------------------------------------

/** Every input the check-in form can render — and the vocabulary the client uses to report which ones it had live at submit. */
export type RenderedFieldKey = CoreFieldKey | "nsbeMembershipId";

/** The payload keys each rendered field submits. A field that wasn't rendered contributes none of them, and the server accepts none of them. */
export const PAYLOAD_KEYS_BY_FIELD: Record<RenderedFieldKey, ReadonlyArray<keyof CoreFormAnswers>> = {
  firstName: ["firstName"],
  lastName: ["lastName"],
  studentId: ["studentId"],
  phone: ["phone"],
  personalEmail: ["personalEmail"],
  tshirtSize: ["tshirtSize"],
  classification: ["classification"],
  // Picking "Other" reveals the free-text box under the same question.
  major: ["major", "majorOther"],
  majorOther: ["majorOther"],
  duesPaid: ["duesPaid"],
  nationalMember: ["nationalMember"],
  nsbeMembershipId: ["nsbeMembershipId"],
  house: ["house", "houseProofFileId", "houseSkipped"],
  resume: ["resumeAction", "resumeFileId"],
};

const RENDERED_FIELD_KEYS = Object.keys(PAYLOAD_KEYS_BY_FIELD) as RenderedFieldKey[];

export function isRenderedFieldKey(key: unknown): key is RenderedFieldKey {
  return typeof key === "string" && (RENDERED_FIELD_KEYS as string[]).includes(key);
}

/** The field whose input displays an error on `payloadKey` — "houseProofFileId" is shown by the House block, "resumeFileId" by Resume. Null for anything the form never renders ("_form", or a key no field owns). */
export function fieldForPayloadKey(payloadKey: string): RenderedFieldKey | null {
  if (isRenderedFieldKey(payloadKey)) return payloadKey;
  return RENDERED_FIELD_KEYS.find((f) => (PAYLOAD_KEYS_BY_FIELD[f] as readonly string[]).includes(payloadKey)) ?? null;
}

/**
 * What the form CAN render for this user at this event — getMissingFields' two
 * reductions, stated once for the renderer and the server alike. An ADMIN, or
 * anyone at an EBOARD_ONLY event, is shown their name and nothing else; every
 * other member can be shown every field (live when missing, or on Edit).
 */
export function askableFields(role: Role, event: { audience: Audience }): Set<RenderedFieldKey> {
  if (role === "admin" || event.audience === "eboard_only") return new Set<RenderedFieldKey>(["firstName", "lastName"]);
  return new Set(RENDERED_FIELD_KEYS);
}

/**
 * The inputs the check-in form has live right now — CoreCheckInForm renders
 * exactly these, and CheckInFlow submits exactly these and reports them as
 * `rendered`, so "what the member was shown" and "what the server accepts"
 * are one computation. A field is live when getMissingFields asks for it, or
 * the member pressed Edit on its receipt row; the NSBE Membership ID is always
 * shown in the member half (optional, never "missing"); the two name inputs
 * render as a pair; and picking "Other" reveals the free-text major.
 */
export function liveFields(input: {
  user: GetMissingFieldsUser;
  event: { audience: Audience };
  config: GetMissingFieldsConfig;
  editing: ReadonlySet<CoreFieldKey>;
  /** The major currently selected in the form, if the member changed it this session. */
  majorValue?: string;
}): Set<RenderedFieldKey> {
  const askable = askableFields(input.user.role, input.event);
  const missing = new Set<RenderedFieldKey>(getMissingFields(input.user, input.event, input.config));
  const live = new Set<RenderedFieldKey>();
  for (const field of askable) {
    if (field === "nsbeMembershipId" || missing.has(field) || input.editing.has(field as CoreFieldKey)) live.add(field);
  }
  if (live.has("firstName") || live.has("lastName")) {
    live.add("firstName");
    live.add("lastName");
  }
  if (live.has("major") && input.majorValue === OTHER_MAJOR) live.add("majorOther");
  return live;
}

/** The stored value a payload key would echo, for the fields the client ever seeds from the profile. */
const STORED_VALUE: Partial<Record<keyof CoreFormAnswers, (u: CheckInProfile) => unknown>> = {
  firstName: (u) => u.firstName,
  lastName: (u) => u.lastName,
  studentId: (u) => u.studentId,
  phone: (u) => u.phone,
  personalEmail: (u) => u.personalEmail,
  tshirtSize: (u) => u.tshirtSize,
  classification: (u) => u.classification,
  major: (u) => u.major,
  majorOther: (u) => u.majorOther,
  nsbeMembershipId: (u) => u.nsbeMembershipId,
  duesPaid: (u) => u.duesPaidReported,
  nationalMember: (u) => u.nationalMemberReported,
  house: (u) => u.house,
};

function normalized(v: unknown): string {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v.trim() : String(v);
}

function echoesStored(key: keyof CoreFormAnswers, value: unknown, user: CheckInProfile): boolean {
  const stored = STORED_VALUE[key];
  return stored !== undefined && normalized(value) === normalized(stored(user));
}

/** GetMissingFieldsUser plus the one optional field the form always shows but never counts as missing. */
export type CheckInProfile = GetMissingFieldsUser & { nsbeMembershipId: string };

export interface CheckInPlan {
  /** getMissingFields for this user and event, computed now. */
  missing: CoreFieldKey[];
  accepted: Set<RenderedFieldKey>;
  /** Handed to validateCoreAnswers as its `missing` — the only fields it may require. */
  required: Set<CoreFieldKey>;
  requiredButNotRendered: CoreFieldKey[];
  /** Payload keys dropped before validation — sent for a field that wasn't shown, or an unchanged echo. */
  dropped: string[];
  /** The payload that gets validated and written: accepted fields only, names filled from the profile when not shown. */
  answers: Record<string, unknown>;
}

/**
 * `rendered` is what the client reports it had live (see CheckInFlow). Null
 * means an older client that doesn't report it — then everything askable is
 * a candidate and an unchanged echo of the stored value is what gets dropped.
 * The echo rule applies either way: re-submitting an unchanged value for a
 * field that isn't missing is a confirmation, not an answer, and needs no
 * check. A field in `missing` is never treated as an echo — confirming a
 * stale classification is exactly how its season gets re-stamped.
 *
 * Trusting `rendered` lets a member skip a question by claiming they weren't
 * shown it. That's harmless by construction: the only thing skipped is a
 * self-report, which stays unanswered — ineligible, and asked again next time.
 */
export function planCheckIn(input: {
  user: CheckInProfile;
  event: { audience: Audience };
  config: GetMissingFieldsConfig;
  answers: unknown;
  rendered: readonly unknown[] | null;
}): CheckInPlan {
  const { user } = input;
  const missing = getMissingFields(user, input.event, input.config);
  const missingSet = new Set<RenderedFieldKey>(missing);
  const askable = askableFields(user.role, input.event);
  const shown = input.rendered === null ? null : new Set(input.rendered.filter(isRenderedFieldKey).filter((k) => askable.has(k)));
  const raw: Record<string, unknown> =
    input.answers !== null && typeof input.answers === "object" && !Array.isArray(input.answers)
      ? (input.answers as Record<string, unknown>)
      : {};

  const accepted = new Set<RenderedFieldKey>();
  for (const field of askable) {
    if (shown && !shown.has(field)) continue;
    const present = PAYLOAD_KEYS_BY_FIELD[field].filter((k) => raw[k] !== undefined);
    if (present.length === 0) continue;
    if (!missingSet.has(field) && present.every((k) => echoesStored(k, raw[k], user))) continue;
    accepted.add(field);
  }

  const answers: Record<string, unknown> = {};
  const kept = new Set<string>();
  for (const field of accepted) {
    for (const key of PAYLOAD_KEYS_BY_FIELD[field]) {
      if (raw[key] === undefined) continue;
      answers[key] = raw[key];
      kept.add(key);
    }
  }
  // The schema requires a name on every submission; one that wasn't shown is
  // the name on file, never whatever a stale page echoed.
  if (!accepted.has("firstName")) answers.firstName = user.firstName;
  if (!accepted.has("lastName")) answers.lastName = user.lastName;

  const required = new Set(missing.filter((f) => !shown || shown.has(f)));
  return {
    missing,
    accepted,
    required,
    requiredButNotRendered: shown ? missing.filter((f) => !shown.has(f)) : [],
    dropped: Object.keys(raw).filter((k) => !kept.has(k)),
    answers,
  };
}

"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { normalizeEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { OTHER_MAJOR } from "@/lib/core-form";
import { hashPassword, validatePasswordStrength } from "@/lib/passwords";
import { requireOrgContext } from "@/lib/org";
import {
  assertNotJoinCodeRateLimited,
  assertNotSignupRateLimited,
  recordJoinCodeAttempt,
  recordSignupAttempt,
} from "@/lib/rate-limit";
import {
  getConfigValue,
  getCoreFormConfig,
  matchJoinCode,
  redeemJoinCodeForSignup,
  setDuesReported,
  setHouseAssignment,
  setNationalReported,
  setResume,
  updateProfileFields,
} from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { clientIpFromHeaders } from "@/lib/request";
import type { Classification, Role, ShirtSize } from "@/lib/types";

const GENERIC_CODE_ERROR = "That join code doesn't work. Check it and try again.";

export interface CheckJoinCodeState {
  error: string | null;
  grantsRole: Role | null;
  label: string | null;
}

/**
 * Read-only preview for step 2 — never mutates useCount. GUEST-granting codes
 * are rejected here with the SAME generic message as a wrong code: /join
 * creates real (password-holding) accounts, and a GUEST row must never have
 * one (see lib/auth.ts authorize()), so a guest code has no business here.
 */
export async function checkJoinCodeAction(_prevState: CheckJoinCodeState, formData: FormData): Promise<CheckJoinCodeState> {
  const { orgId } = await requireOrgContext();
  const ip = await clientIpFromHeaders();
  const code = String(formData.get("code") ?? "").trim();

  try {
    assertNotJoinCodeRateLimited(ip);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, grantsRole: null, label: null };
    throw err;
  }
  recordJoinCodeAttempt(ip);

  if (!code) return { error: GENERIC_CODE_ERROR, grantsRole: null, label: null };

  const match = await matchJoinCode(orgId, code);
  if (!match || match.grantsRole === "guest") {
    return { error: GENERIC_CODE_ERROR, grantsRole: null, label: null };
  }
  return { error: null, grantsRole: match.grantsRole, label: match.label };
}

export interface CreateAccountState {
  error: string | null;
  fieldErrors?: Record<string, string>;
  ok: boolean;
  grantsRole: Role | null;
  /**
   * The account was created but the automatic post-signup sign-in failed —
   * the wizard must NOT advance to the profile steps (they all require a
   * session). The client sends the user to /signin instead, with `email`
   * prefilled, rather than leaving them stuck on an unauthenticated wizard
   * step that can only fail with UNAUTHENTICATED.
   */
  redirectToSignIn?: boolean;
  email?: string;
}

/**
 * The actual account-creation step — bundles the wizard's "Account" (step 3)
 * and "About you" (step 4) fields into one call, since redeemJoinCodeForSignup
 * needs a name to create the row with. Re-validates the code from scratch
 * (never trusts step 2's preview) and re-checks the rate limit.
 */
export async function createAccountAction(_prevState: CreateAccountState, formData: FormData): Promise<CreateAccountState> {
  const { orgId } = await requireOrgContext();
  const ip = await clientIpFromHeaders();

  try {
    assertNotSignupRateLimited(ip);
    assertNotJoinCodeRateLimited(ip);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, ok: false, grantsRole: null };
    throw err;
  }

  const code = String(formData.get("code") ?? "").trim();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const studentId = String(formData.get("studentId") ?? "").trim();
  const classificationRaw = String(formData.get("classification") ?? "").trim();
  const major = String(formData.get("major") ?? "").trim();
  const majorOther = String(formData.get("majorOther") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  const domain = (await getConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", "")).trim().toLowerCase();
  if (!email || (domain && !email.endsWith(domain))) {
    fieldErrors.email = domain ? `Email must end with ${domain}` : "Enter a valid email";
  }
  const strength = validatePasswordStrength(password);
  if (!strength.ok) fieldErrors.password = strength.message ?? "Password isn't strong enough.";
  if (password !== confirmPassword) fieldErrors.confirmPassword = "Passwords don't match";
  if (!firstName) fieldErrors.firstName = "Required";
  if (!lastName) fieldErrors.lastName = "Required";
  if (!studentId) fieldErrors.studentId = "Required";
  if (!classificationRaw) fieldErrors.classification = "Required";
  if (!major) fieldErrors.major = "Required";
  if (major === OTHER_MAJOR && !majorOther) fieldErrors.majorOther = "Tell us your major";

  if (Object.keys(fieldErrors).length > 0) {
    recordJoinCodeAttempt(ip);
    return { error: "Check the highlighted fields.", fieldErrors, ok: false, grantsRole: null };
  }

  // A code is only checked (and only rejected for guessing/guest-granting)
  // when one was actually submitted — general signup sends none at all, and
  // an empty code isn't "wrong," it's the whole point: redeemJoinCodeForSignup
  // treats it as "create a plain GENERAL account." EBOARD/ADMIN still go
  // through the wizard's code step, which never lets Continue fire without a
  // code, so a non-empty code here always means a real attempt to redeem one.
  if (code) {
    // Guest codes never reach this point either — same reasoning as checkJoinCodeAction.
    const preview = await matchJoinCode(orgId, code);
    if (!preview || preview.grantsRole === "guest") {
      recordJoinCodeAttempt(ip);
      return { error: GENERIC_CODE_ERROR, fieldErrors: { code: GENERIC_CODE_ERROR }, ok: false, grantsRole: null };
    }
  }

  const passwordHash = await hashPassword(password);
  try {
    const result = await redeemJoinCodeForSignup({
      orgId,
      submittedCode: code,
      email,
      passwordHash,
      firstName,
      lastName,
      profile: {
        studentId,
        classification: classificationRaw as Classification,
        major: major === OTHER_MAJOR ? OTHER_MAJOR : major,
        majorOther: major === OTHER_MAJOR ? majorOther : undefined,
      },
    });
    recordSignupAttempt(ip);

    try {
      await signIn("credentials", { email, password, orgId, redirect: false });
    } catch (error) {
      if (error instanceof AuthError) {
        // The account is real and not an orphan — it just isn't signed in.
        // `ok: false` here is deliberate: it must NOT look like success to
        // AccountStep, or the wizard advances into steps that require a
        // session and fail with UNAUTHENTICATED. Send the user to /signin
        // instead, with their email prefilled.
        return {
          error: "Account created, but signing you in failed. Sign in to continue.",
          ok: false,
          grantsRole: null,
          redirectToSignIn: true,
          email,
        };
      }
      throw error;
    }

    return { error: null, ok: true, grantsRole: result.grantsRole };
  } catch (err) {
    if (err instanceof AppError) {
      recordJoinCodeAttempt(ip);
      return { error: err.message, fieldErrors: err.fieldErrors, ok: false, grantsRole: null };
    }
    throw err;
  }
}

export interface JoinStepState {
  error: string | null;
  /**
   * Set when the failure is specifically "no session" — requireSession()
   * throws UNAUTHENTICATED if the wizard reached a profile step without one
   * (e.g. the post-signup sign-in in createAccountAction failed and the user
   * came back from /signin, or the session simply expired mid-wizard). The
   * client shows a distinct "sign in again" message rather than a generic
   * save error, since retrying the same step can't fix this on its own.
   */
  sessionExpired?: boolean;
}

const SESSION_EXPIRED_STATE: JoinStepState = {
  error: "Your session expired. Sign in again to keep going — your answers are saved.",
  sessionExpired: true,
};

/**
 * Every profile step below needs a session but must never let requireSession()
 * throw uncaught — an uncaught throw from a Server Action reaches the wizard
 * as a raw, unhandled error instead of the graceful { error } state every
 * other failure in this file returns. Steps 4-8 only ever run after step 3
 * has signed the user in, so this should be rare in practice, but a session
 * can still expire mid-wizard.
 */
async function requireWizardSession() {
  try {
    return await requireSession();
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") return null;
    throw err;
  }
}

/** Step 5 — Contact. Phone and personal email are required (Part 2) — the wizard's Continue button won't fire without both, and this is the server-side half of that rule. T-shirt size is the only field on this step that stays optional. */
export async function updateContactAction(input: {
  phone: string;
  personalEmail: string;
  tshirtSize?: ShirtSize;
}): Promise<JoinStepState> {
  const session = await requireWizardSession();
  if (!session) return SESSION_EXPIRED_STATE;
  const phone = input.phone.trim();
  const personalEmail = input.personalEmail.trim();
  if (!phone || !personalEmail) {
    return { error: "Phone and personal email are required." };
  }
  try {
    await updateProfileFields(session.user.orgId, session.user.email, { phone, personalEmail, tshirtSize: input.tshirtSize }, session.user.email);
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/**
 * Membership — dues, national status, and the NSBE Membership ID. Skipped
 * only by ADMIN accounts, via the wizard's own step list (see
 * joinWizardRules.ts stepsFor); an EBOARD signup answers it like any member.
 * The ID is optional and independent of the national answer: it's written
 * whenever one was typed, and answering No never clears it.
 */
export async function updateMembershipAction(input: {
  duesPaid: boolean;
  nationalMember: boolean;
  nsbeMembershipId?: string;
}): Promise<JoinStepState> {
  const session = await requireWizardSession();
  if (!session) return SESSION_EXPIRED_STATE;
  try {
    await Promise.all([
      setDuesReported(session.user.orgId, session.user.email, input.duesPaid, session.user.email),
      setNationalReported(
        session.user.orgId,
        session.user.email,
        input.nationalMember,
        session.user.email,
        input.nsbeMembershipId,
      ),
    ]);
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export interface HouseStepInput {
  /**
   * The member explicitly chose "I haven't taken the test yet." REQUIRED to
   * be present (true or false) — an absent flag is a malformed submission,
   * not a skip.
   *
   * This is the server-side half of the House step, and it is the half that
   * was missing: the step used to accept "no arguments at all" as a complete
   * answer, so any POST that simply omitted the House fields — an abandoned
   * wizard, a replayed request, a client that never rendered the step —
   * sailed through and left an ACTIVE account with a null House. The House
   * answer is now mandatory; WHICH answer is still the member's choice, and
   * "not yet" remains a legitimate one (the House test is an external site;
   * a member genuinely may not have taken it). An unanswered step is
   * rejected, and getMissingFields keeps asking until it IS answered — see
   * lib/core-form.ts, and docs/CLAIM-STATE.md for the (b) decision.
   */
  houseSkipped: boolean;
  house?: string;
  houseProofFileId?: string;
}

/**
 * Step 7 — House. No Yes/No question (Part 1 restructure): an explicit skip
 * ("I haven't taken the test yet") is a complete, valid answer for every
 * role, but it must be stated, not inferred from silence. It writes nothing
 * (house stays null), and getMissingFields re-asks at the member's next
 * check-in and lists it on /account. Providing a House requires the
 * screenshot and vice versa, re-checked server-side independently of
 * whatever the client already validated — except for a role that
 * self-verifies, where the House alone is complete.
 */
export async function setHouseAction(input: HouseStepInput): Promise<JoinStepState> {
  const session = await requireWizardSession();
  if (!session) return SESSION_EXPIRED_STATE;

  const { houseSkipped, house, houseProofFileId } = input ?? {};
  if (typeof houseSkipped !== "boolean") {
    return { error: `Answer the House step — pick your House, or choose "I haven't taken the test yet."` };
  }

  // An explicit skip. Anything the client may have half-filled is discarded:
  // the member said they don't have a result yet, and that answer wins.
  if (houseSkipped) return { error: null };

  // Not a skip, so a real answer is required — a POST that reaches here with
  // nothing in it is rejected rather than silently treated as a skip.
  if (!house && !houseProofFileId) {
    return { error: `Select your House and upload your screenshot, or choose "I haven't taken the test yet."` };
  }

  const trimmedHouse = house?.trim() ?? "";
  const { houses } = await getCoreFormConfig(session.user.orgId);
  if (!trimmedHouse || !houses.some((h) => h.name === trimmedHouse)) {
    return { error: "Select your House." };
  }
  // Whether a screenshot is required is decided by the roster role inside
  // setHouseAssignment (see lib/core-form.ts houseSelfVerifies) — checking
  // it here would mean trusting this request's session role and would put a
  // second copy of the rule in the codebase.

  try {
    await setHouseAssignment(session.user.orgId, session.user.email, trimmedHouse, houseProofFileId, session.user.email);
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/** Step 8 — Resume. Skippable ("Do this later"). */
export async function setResumeAction(resumeFileId: string): Promise<JoinStepState> {
  const session = await requireWizardSession();
  if (!session) return SESSION_EXPIRED_STATE;
  try {
    await setResume(session.user.orgId, session.user.email, resumeFileId, session.user.email);
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

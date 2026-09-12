/**
 * When a signup is finished, and where an unfinished one picks up.
 *
 * THE MODEL: no step index is stored anywhere. The resume point is DERIVED
 * from the profile data every time it is needed, by the same
 * lib/core-form.ts getMissingFields that drives the check-in form and
 * /account's completeness panel. A stored step number would go stale the
 * moment anything else wrote to the profile — an admin filling a field in from
 * /admin/members/[id], the member answering the same question at check-in on
 * another device, a bulk import. Deriving it means all of those resume
 * correctly with no reconciliation.
 *
 * User.signupCompletedAt is the one piece of stored state, and it is a latch,
 * not a position: null means "mid-signup", set means "done, never ask again".
 * It exists because two things are true at once —
 *
 *   - "every required step answered" has to be answerable from data, so the
 *     resume point can be derived (this module's predicates); and
 *   - "answered" is not the same as "populated". The House step can be
 *     completed by pressing "I haven't taken the test yet", which by design
 *     writes nothing at all (see lib/repo.ts clearHouseAssignment and
 *     docs/CLAIM-STATE.md). Without a latch, that member would be asked the
 *     same question forever.
 *
 * So: the latch decides whether to redirect; these predicates decide where to
 * resume and when the latch may be set.
 *
 * SIGNUP-COMPLETE IS NOT CHECK-IN-COMPLETE. getMissingFields answers "what
 * should I ask at this check-in", which is a deliberately stricter and
 * seasonal question. Four documented divergences, each with a reason:
 *
 *   tshirtSize   Optional on the wizard's Contact step (it is literally
 *                labelled "optional" and never gates Continue). Asked again
 *                at the first check-in.
 *   resume       Explicitly skippable ("Do this later"). Surfaces later via
 *                getMissingFields at check-in and on /account.
 *   dues,        Signup needs these ANSWERED, not true. "No, I haven't paid
 *   national     yet" is a complete answer to the question the wizard asks;
 *                check-in re-asks until it is true and current, which is a
 *                different question and stays that way.
 *   season       Signup asks each question once. Seasonal staleness is
 *                check-in's concern — a returning member whose classification
 *                is a season old has not become mid-signup again, and must
 *                never be dragged back through a wizard in August.
 */

import { getMissingFields, type CoreFieldKey, type GetMissingFieldsUser } from "./core-form";
import type { Role } from "./types";

export type StepKey = "type" | "code" | "account" | "about" | "contact" | "membership" | "house" | "resume";

export type AccountType = "general" | "eboard" | "admin" | null;

/**
 * `accountType` is the step-1 picker's client-side hint — it only decides
 * whether the "code" step is shown at all (a General signup needs no code,
 * so it goes straight from the picker to the account step). `resolvedRole`
 * is the server-confirmed role from the redeemed code (or "general" itself,
 * for a codeless signup) — it's what decides whether the profile steps are
 * skipped. The two are deliberately separate: the picker is never
 * authorization, only UI routing (see JoinWizard.tsx's JoinCodeStep copy).
 *
 * An ADMIN account is a staff login, not a member profile: it stops after the
 * account step (email/password plus name, student ID, classification and
 * major), skipping About you, Contact, Membership, House and Resume.
 *
 * An EBOARD signup answers everything a GENERAL one does EXCEPT House. An
 * officer is otherwise a student with a shirt size, dues and a national
 * membership like any member, but the House question — the personality test link
 * and its screenshot — is not asked of them at signup, and lib/core-form.ts
 * getMissingFields correspondingly never asks for it at check-in either. It
 * remains available as an optional field on /account.
 *
 * Note this is about WHO IS SIGNING UP. The reduced core form on EBOARD_ONLY
 * events is a separate rule about WHAT EVENT you're at — see
 * lib/core-form.ts getMissingFields. The two must never be collapsed.
 */
export function stepsFor(accountType: AccountType, resolvedRole: Role | null): StepKey[] {
  const base: StepKey[] = ["type"];
  if (accountType !== "general") base.push("code");
  base.push("account");
  if (resolvedRole === "admin") return base;
  const profile: StepKey[] = ["about", "contact", "membership"];
  if (resolvedRole !== "eboard") profile.push("house");
  profile.push("resume");
  return [...base, ...profile];
}

/**
 * The canonical step list for an account that ALREADY EXISTS, which is the
 * only case the resume flow ever sees. The role on the roster tells us
 * whether a code was used: only a code can grant EBOARD or ADMIN, and a
 * GENERAL signup needs none — the same rule stepsFor already encodes, so the
 * numbering a resuming user sees matches the numbering they saw first time
 * through ("Step 5 of 8" means the same thing in both).
 */
export function signupStepsFor(role: Role): StepKey[] {
  return stepsFor(role === "general" || role === "guest" ? "general" : role, role === "guest" ? "general" : role);
}

/** Steps with no data of their own: pre-account routing, and the account step itself, which is done by virtue of the account existing. */
const PRE_ACCOUNT_STEPS: ReadonlySet<StepKey> = new Set<StepKey>(["type", "code", "account"]);

/** Skippable at signup, so never required for completion. See the divergences in this module's header. */
const OPTIONAL_AT_SIGNUP: ReadonlySet<CoreFieldKey> = new Set<CoreFieldKey>(["tshirtSize", "resume"]);

/**
 * Which wizard step asks for each field. "about" is the review screen for
 * what the account step collected — an admin-provisioned account (see
 * lib/repo.ts createMemberAccount, which writes only email and name) has none
 * of it, so that step genuinely can be the resume point.
 */
const STEP_FOR_FIELD: Record<CoreFieldKey, StepKey> = {
  firstName: "about",
  lastName: "about",
  studentId: "about",
  classification: "about",
  major: "about",
  majorOther: "about",
  phone: "contact",
  personalEmail: "contact",
  tshirtSize: "contact",
  duesPaid: "membership",
  nationalMember: "membership",
  house: "house",
  resume: "resume",
};

export interface SignupUser extends GetMissingFieldsUser {
  /** The latch. Null means mid-signup; a date means finished and never re-asked. */
  signupCompletedAt: Date | null;
}

export interface SignupOptions {
  /**
   * The member pressed "I haven't taken the test yet" in THIS flow. The skip
   * writes nothing by design, so it cannot be read back from the row — the
   * client states it, exactly as it already does to join/actions.ts
   * setHouseAction, which has always taken this on the same trust.
   */
  houseSkipped?: boolean;
}

/**
 * Every required field still unanswered, in the wizard's own order.
 *
 * Built on getMissingFields so there is one implementation of "what's
 * missing", then adjusted for the four documented signup divergences above.
 * Season is neutralised by asking getMissingFields to compare the profile
 * against its OWN season, which makes every check a presence check rather
 * than a freshness one.
 */
export function missingSignupFields(user: SignupUser, options: SignupOptions = {}): CoreFieldKey[] {
  const missing = new Set(getMissingFields(user, { audience: "all" }, { SEASON: user.profileSeason }));

  for (const field of OPTIONAL_AT_SIGNUP) missing.delete(field);

  // Answered, not true — and not seasonal. See the header.
  if (user.duesPaidReported !== null) missing.delete("duesPaid");
  if (user.nationalMemberReported !== null) missing.delete("nationalMember");

  if (options.houseSkipped) missing.delete("house");

  return (Object.keys(STEP_FOR_FIELD) as CoreFieldKey[]).filter((f) => missing.has(f));
}

/**
 * The steps the resume flow still has to show, in wizard order. Derived, never
 * stored — call it again after any write and it is correct again.
 */
export function missingSignupSteps(user: SignupUser, options: SignupOptions = {}): StepKey[] {
  const steps = new Set(missingSignupFields(user, options).map((f) => STEP_FOR_FIELD[f]));
  return signupStepsFor(user.role).filter((s) => steps.has(s) && !PRE_ACCOUNT_STEPS.has(s));
}

/**
 * THE definition of "signup complete", and the only one. Used by:
 *   - lib/repo.ts completeSignup, which refuses to set the latch until it holds
 *   - the /join/resume page, to decide whether there is anything left to ask
 *   - prisma/migrations/…_add_signup_completed_at, whose SQL mirrors it to
 *     backfill accounts that predate the column
 *
 * Note what it does NOT decide: whether to redirect. That is the latch alone
 * (see signupIsComplete) — a member who completed signup by skipping the
 * House step does not satisfy this predicate and must never be asked again.
 */
export function requiredSignupFieldsComplete(user: SignupUser, options: SignupOptions = {}): boolean {
  return missingSignupSteps(user, options).length === 0;
}

/**
 * The redirect decision, for the member layout and the resume page both. The
 * latch wins outright: once signup is finished it is finished, whatever the
 * data says afterwards (a member can null out their own House from /account
 * without becoming mid-signup again).
 *
 * A row with no latch that already satisfies the predicate is treated as
 * complete too, so an account that predates the backfill — or one an admin
 * filled in completely by hand — is never sent through a wizard for nothing.
 */
export function signupIsComplete(user: SignupUser): boolean {
  return user.signupCompletedAt !== null || requiredSignupFieldsComplete(user);
}

/** 1-based position of `step` in the full list for this role, for "Step 5 of 8". */
export function signupStepPosition(role: Role, step: StepKey): { position: number; total: number } {
  const steps = signupStepsFor(role);
  const index = steps.indexOf(step);
  return { position: index === -1 ? steps.length : index + 1, total: steps.length };
}

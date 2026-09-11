/**
 * The ONE definition of what state a self-reported membership claim is in.
 *
 * "Self-reported" and "verified" are two different things and always were —
 * conflating them is what made the roster render a green check for a claim
 * nobody had ever checked. Every surface that renders a dues/national claim,
 * and every query that builds the Membership Audit queue, goes through this
 * function; there is no second opinion anywhere in the codebase.
 *
 *   none      the member never said yes (reported is null or false, and no
 *             admin has ever adjudicated it)
 *   pending   the member said yes, nobody has checked it yet
 *   verified  an admin confirmed it against the real record
 *   revoked   an admin determined the claim was false
 *
 * NOT an eligibility rule. Leaderboard eligibility is driven by the REPORTED
 * flags alone (see lib/points.ts isEligible) — verification is an audit layer
 * on top, and a "pending" claim counts for standings exactly like a verified
 * one. Nothing here may ever be wired into isEligible.
 */
export type ClaimState = "none" | "pending" | "verified" | "revoked";

/**
 * Precedence is verified > revoked > pending > none, and it only ever has to
 * break a tie because of history: the writers keep verified and revoked
 * mutually exclusive (verifyDues clears the revoke stamps, revokeDues clears
 * the verify stamp, and re-reporting a previously-revoked claim clears the
 * revoke stamps — see lib/repo.ts). A claim re-reported after a revoke is
 * `pending` again, because it is a NEW claim awaiting a NEW decision; if the
 * old revoke stamp survived it would hide the member from the audit queue
 * forever while they sat on the leaderboard.
 */
export function claimState(
  reported: boolean | null | undefined,
  verifiedAt: Date | null | undefined,
  revokedAt: Date | null | undefined,
): ClaimState {
  if (verifiedAt) return "verified";
  if (revokedAt) return "revoked";
  if (reported === true) return "pending";
  return "none";
}

/** Human label for a claim state — shared by the roster, the audit queue, the member detail panel, and CSV export so they can't drift. */
export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  none: "Not reported",
  pending: "Self-reported",
  verified: "Verified",
  revoked: "Revoked",
};

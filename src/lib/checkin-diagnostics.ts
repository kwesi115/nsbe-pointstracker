/**
 * Server-side logging for the check-in submit path — the evidence for "a member
 * saw 'Check the highlighted fields.' and nothing was highlighted".
 *
 * Structured JSON on one line, same shape as the code_verify_failed log in
 * lib/repo.ts verifyEventCodeOrThrow, so it can be grepped out of the Vercel
 * logs by its `event`. Never the answers themselves — field NAMES and error
 * messages only; a check-in carries phone numbers and emails.
 */

import { fieldForPayloadKey, isRenderedFieldKey, type CoreFieldKey } from "./core-form";

export interface CheckInRejection {
  orgId: string;
  userId: string;
  eventId: string;
  /** Empty for a 422 that carries none (e.g. an uploaded file that isn't this member's). */
  fieldErrors: Record<string, string>;
  message: string;
  /** What the client reported it had live — null from a client too old to report it. */
  rendered: readonly unknown[] | null;
  /** getMissingFields at submit time, for this user and event. */
  missing: CoreFieldKey[];
  /** The event's extra questions — always rendered, so never "unrendered". */
  extraFieldKeys: string[];
}

/**
 * Error keys the member could not have seen highlighted: a core field the
 * client didn't report rendering, or a key no input owns at all ("_form",
 * from a root-level schema issue). With no `rendered` report, only the
 * latter can be known.
 */
export function unrenderedErrorKeys(
  fieldErrors: Record<string, string>,
  rendered: readonly unknown[] | null,
  extraFieldKeys: readonly string[],
): string[] {
  const shown = new Set((rendered ?? []).filter(isRenderedFieldKey));
  return Object.keys(fieldErrors).filter((key) => {
    if (extraFieldKeys.includes(key)) return false;
    const field = fieldForPayloadKey(key);
    if (field === null) return true;
    return rendered !== null && !shown.has(field);
  });
}

/** Every 422 from the register endpoint. Escalates to an error when it names a field the member couldn't see — that is a server bug, never the member's. */
export function logCheckInRejection(r: CheckInRejection): void {
  const unrendered = unrenderedErrorKeys(r.fieldErrors, r.rendered, r.extraFieldKeys);
  const entry = {
    orgId: r.orgId,
    userId: r.userId,
    eventId: r.eventId,
    message: r.message,
    fieldErrors: r.fieldErrors,
    rendered: r.rendered,
    missing: r.missing,
    unrendered,
  };
  console.warn(JSON.stringify({ event: "checkin_rejected", ...entry }));
  if (unrendered.length > 0) console.error(JSON.stringify({ event: "checkin_error_on_unrendered_field", ...entry }));
}

/**
 * The server found a question missing that the member was never shown — the
 * profile changed between page load and submit (a SEASON bump, an admin
 * revoking dues or rejecting a House, a role change). The check-in is
 * accepted without it (see lib/core-form.ts planCheckIn); this is the record
 * that it happened.
 */
export function logRequiredButNotRendered(r: { orgId: string; userId: string; eventId: string; fields: CoreFieldKey[]; rendered: readonly unknown[] | null }): void {
  console.error(JSON.stringify({ event: "checkin_required_field_not_rendered", ...r }));
}

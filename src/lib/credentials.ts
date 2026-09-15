/**
 * The credential check at sign-in, kept apart from the Auth.js plumbing in
 * src/auth.ts so it can be tested without a request, a session or a database.
 *
 * An account holds at most one credential (see prisma/schema.prisma model User):
 *
 *   - a pending SETUP CODE (passwordHash null) — compared forgivingly: case,
 *     surrounding whitespace, inner spaces and hyphens don't matter
 *     (lib/setup-code.ts normalizeSetupCode). A code is typed by hand from
 *     something an officer read out or wrote down, into a masked field.
 *   - a real PASSWORD — compared exactly. A password is never normalized.
 *   - nothing at all (a GUEST row) — never signs in.
 *
 * Accounts left pending by the old scheme hold their code as a bcrypt hash in
 * passwordHash; those get the same forgiveness, but only while
 * mustChangePassword is set, so a real password is still never normalized.
 */

import { verifyPassword } from "./passwords";
import { normalizeSetupCode, setupCodeMatches } from "./setup-code";
import type { AuthRecord } from "./types";

export type CredentialCheck = { ok: false } | { ok: true; mustChangePassword: boolean };

const FAIL: CredentialCheck = { ok: false };

export async function checkCredentials(
  record: Pick<AuthRecord, "role" | "passwordHash" | "setupCode" | "mustChangePassword">,
  submitted: string,
): Promise<CredentialCheck> {
  // A guest must never be able to sign in (Part 5), whatever the row holds.
  if (record.role === "guest") {
    await verifyPassword(submitted, undefined);
    return FAIL;
  }

  if (record.setupCode) {
    // Pay a bcrypt compare anyway, so a pending account answers in the same
    // time as a password account.
    await verifyPassword(submitted, undefined);
    return setupCodeMatches(submitted, record.setupCode) ? { ok: true, mustChangePassword: true } : FAIL;
  }

  if (!record.passwordHash) {
    await verifyPassword(submitted, undefined);
    return FAIL;
  }

  if (await verifyPassword(submitted, record.passwordHash)) {
    return { ok: true, mustChangePassword: record.mustChangePassword };
  }

  if (record.mustChangePassword) {
    const normalized = normalizeSetupCode(submitted);
    if (normalized && normalized !== submitted && (await verifyPassword(normalized, record.passwordHash))) {
      return { ok: true, mustChangePassword: true };
    }
  }

  return FAIL;
}

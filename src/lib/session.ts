/**
 * Server-side auth guards for pages and route handlers. Not usable in
 * middleware — auth() runs the session callback, which reads the workbook.
 */

import type { Session } from "next-auth";
import { forbidden } from "next/navigation";
import { auth } from "@/auth";
import { AppError } from "./errors";
import { isEboardOrAdmin } from "./points";
import { getRole } from "./repo";

export { isEboardOrAdmin };

/**
 * The copy a denied Server Action or Route Handler reports. Kept in step with
 * lib/access.ts denialCopy() by access.test.ts — an action and the page it
 * lives on should not describe the same refusal two different ways.
 */
const ADMIN_DENIAL_MESSAGE = "This page is admin-only. If you need access, ask a current admin to grant it.";
const EBOARD_DENIAL_MESSAGE = "This page is E-Board only. If you need access, ask a current admin to grant it.";

export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user?.email) {
    throw new AppError("UNAUTHENTICATED", "You must be signed in");
  }
  return session;
}

/**
 * A session for one org must never satisfy a check against another org's
 * routes (Part 6) — this is the assertion every org-scoped page/action that
 * knows its target org (from the URL segment) should run in addition to
 * requireSession()/requireAdmin()/requireEboard(). Those two already call it
 * internally against the session's OWN org; this export exists for the rarer
 * case a caller resolves orgId from a URL param and needs to check it against
 * an already-fetched session.
 */
export function assertOrgMatch(session: Session, orgId: string): void {
  if (session.user.orgId !== orgId) {
    throw new AppError("FORBIDDEN", "Not found in this organization");
  }
}

/**
 * True ADMIN only — join codes, org settings, member role changes. Re-reads
 * the role from the roster rather than trusting session.user.role — a JWT
 * minted before someone was promoted/demoted still carries the old role
 * until it expires, and admin access can't wait out a token's lifetime.
 */
export async function requireAdmin(): Promise<Session> {
  const session = await requireSession();
  const role = await getRole(session.user.orgId, session.user.email);
  if (role !== "admin") {
    throw new AppError("FORBIDDEN", ADMIN_DENIAL_MESSAGE, { denial: { kind: "admin" } });
  }
  return session;
}

/**
 * EBOARD-or-above — event management, verifications, internal leaderboard.
 * This is what most of the ~15 existing "admin" surfaces actually meant
 * before Part 6 split ADMIN out above EBOARD; they call this now instead of
 * requireAdmin().
 */
export async function requireEboard(): Promise<Session> {
  const session = await requireSession();
  const role = await getRole(session.user.orgId, session.user.email);
  if (role !== "admin" && role !== "eboard") {
    throw new AppError("FORBIDDEN", EBOARD_DENIAL_MESSAGE, { denial: { kind: "eboard" } });
  }
  return session;
}

/**
 * Same DB-role-recheck as requireEboard(), but calls next/navigation's
 * forbidden() — a real 403 status — instead of throwing AppError, which a
 * Server Component's generic error boundary always reports as 500. Only used
 * where a true 403 is actually required (the internal E-Board leaderboard).
 */
export async function requireEboardForbidden(): Promise<Session> {
  const session = await requireSession();
  const role = await getRole(session.user.orgId, session.user.email);
  if (role !== "admin" && role !== "eboard") {
    forbidden();
  }
  return session;
}

/** requireAdmin()'s real-403 counterpart — member management/role changes and join codes are ADMIN-only surfaces where an EBOARD officer should see a true 403, not a 500. */
export async function requireAdminForbidden(): Promise<Session> {
  const session = await requireSession();
  const role = await getRole(session.user.orgId, session.user.email);
  if (role !== "admin") {
    forbidden();
  }
  return session;
}

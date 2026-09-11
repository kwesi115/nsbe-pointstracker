/**
 * The permissions engine — the ONLY place a caller checks a narrow,
 * revocable capability grant (see prisma/schema.prisma PermissionGrant,
 * lib/repo.ts grantPermission/revokePermission/hasPermission). Nothing
 * outside this file should hand-roll a check against PermissionGrant.
 *
 * ADMIN and EBOARD already have every capability a grant could give — they
 * short-circuit true below without a database round trip. A GENERAL/GUEST
 * member needs an active grant, checked live on every call (see
 * lib/repo.ts hasPermission) — same reasoning as lib/session.ts
 * requireAdmin's own live role re-read: a JWT never carries a permission
 * grant, so a revoke takes effect on the very next request, not "whenever
 * the token expires."
 */

import { forbidden } from "next/navigation";
import type { Session } from "next-auth";
import { denialMessage } from "./access";
import { AppError } from "./errors";
import { hasPermission } from "./repo";
import { requireSession } from "./session";
import type { PermissionName } from "./types";

async function isAllowed(session: Session, permission: PermissionName): Promise<boolean> {
  if (session.user.role === "admin" || session.user.role === "eboard") return true;
  return hasPermission(session.user.orgId, session.user.email, permission);
}

/** /admin/verifications and its actions — EBOARD/ADMIN always, or a GENERAL member holding the verifications_write grant. Real 403 (not a 500 error-boundary page), same reasoning as lib/session.ts requireEboardForbidden. */
export async function requireVerificationsWrite(): Promise<Session> {
  const session = await requireSession();
  if (!(await isAllowed(session, "verifications_write"))) {
    forbidden();
  }
  return session;
}

/**
 * The general server-action/route-handler grant guard: EBOARD/ADMIN always,
 * or a GENERAL member holding `permission`. Throws an AppError carrying the
 * denial, so the caller can report WHICH grant was missing ("requires the
 * Membership audit permission") instead of a generic refusal — see
 * lib/access.ts denialCopy, which produces the same sentence the
 * access-denied page shows.
 */
export async function requirePermission(permission: PermissionName): Promise<Session> {
  const session = await requireSession();
  if (!(await isAllowed(session, permission))) {
    throw new AppError("FORBIDDEN", denialMessage({ kind: "permission", permission }), {
      denial: { kind: "permission", permission },
    });
  }
  return session;
}

/** Server-action counterpart to requireVerificationsWrite — throws AppError (caught by the action's own try/catch) instead of calling next/navigation's forbidden(), which only works from a Server Component render. */
export async function requireVerificationsWriteAction(): Promise<Session> {
  const session = await requireSession();
  if (!(await isAllowed(session, "verifications_write"))) {
    throw new AppError("FORBIDDEN", denialMessage({ kind: "permission", permission: "verifications_write" }), {
      denial: { kind: "permission", permission: "verifications_write" },
    });
  }
  return session;
}

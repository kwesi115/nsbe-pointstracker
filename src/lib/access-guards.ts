/**
 * The IO half of the access system: load what lib/access.ts's pure policy
 * needs, apply it, and hand back either the session or the reason it was
 * refused. Split from access.ts so the policy stays importable without
 * next-auth — see the note at the top of that file.
 */

import type { Session } from "next-auth";
import {
  denialFor,
  denialMessage,
  isAllowed,
  type AdminAccess,
  type AdminPageDenied,
  type Requirement,
} from "./access";
import { AppError } from "./errors";
import { isFeatureEnabled } from "./features";
import { getActivePermissions, getRole } from "./repo";
import { requireSession } from "./session";

/**
 * Role and grants are re-read live on every request rather than trusted from
 * the JWT, for the same reason lib/session.ts requireAdmin does it: a token
 * minted before a demotion or a revoke still carries the old answer, and admin
 * access can't wait out a token's lifetime.
 */
export async function loadAdminAccess(session: Session): Promise<AdminAccess> {
  const { orgId, email } = session.user;
  const [role, permissions, exportsEnabled] = await Promise.all([
    getRole(orgId, email),
    getActivePermissions(orgId, email),
    isFeatureEnabled(orgId, "exports"),
  ]);
  return { role: role ?? session.user.role, permissions, features: { exports: exportsEnabled } };
}

export type AdminPageGuard = { ok: true; session: Session; access: AdminAccess } | AdminPageDenied;

/**
 * The page-level guard. Returns the denial instead of throwing it, so the page
 * can render <AccessDenied denied={guard} /> from the server with the specific
 * copy intact. A thrown error cannot do that: Next.js strips the message and
 * every custom property off a Server Component error before it reaches
 * error.tsx in production (see admin/error.tsx), which would leave the
 * boundary unable to tell a permission denial from a real crash.
 *
 * Server Actions and Route Handlers still throw — they have real error
 * channels of their own (an action result, a JSON body) that survive the trip.
 */
export async function guardAdminPage(requirement: Requirement): Promise<AdminPageGuard> {
  const session = await requireSession();
  const access = await loadAdminAccess(session);
  const denial = denialFor(access, requirement);
  if (!denial) return { ok: true, session, access };
  return { ok: false, denial, canUseAdminHome: isAllowed(access, { level: "eboard" }) };
}

/**
 * The Server Action / Route Handler counterpart to guardAdminPage(). Throws an
 * AppError carrying the denial, which lib/api.ts withApiErrors turns into a
 * 403 JSON body of { code, message } — never HTML, whatever the caller is. A
 * Server Action's own try/catch surfaces the same message to the client.
 */
export async function requireAccess(requirement: Requirement): Promise<Session> {
  const session = await requireSession();
  const access = await loadAdminAccess(session);
  const denial = denialFor(access, requirement);
  if (denial) throw new AppError("FORBIDDEN", denialMessage(denial), { denial });
  return session;
}

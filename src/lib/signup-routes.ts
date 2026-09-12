/**
 * Where the signup gate applies, and the one pair of URLs it moves people
 * between. Pure string logic, so both guards and their tests can use it
 * without a request.
 *
 * WHY THE GATE IS NOT IN proxy.ts
 * -------------------------------
 * The brief asked for middleware. It is in (member)/layout.tsx instead, for a
 * reason that is the same reason the brief asked twice for "no redirect loop":
 *
 * proxy.ts reads the session with getToken(), which decrypts the JWT and
 * deliberately does not run auth.ts's callbacks ("keep this boundary check
 * cheap"). So a middleware gate would have to read the latch from the token.
 * A JWT is minted at sign-in and not rewritten afterwards — so the moment a
 * member finishes the resume flow, the database says complete and their token
 * still says incomplete. Middleware would bounce them to /join/resume, the
 * resume page would read the database, see a finished signup, and send them to
 * /events, where middleware would bounce them again. That is an infinite loop,
 * and it fires on the single most important request in the whole feature: the
 * one right after someone finishes.
 *
 * Every protected prefix (/events, /dashboard, /account, /leaderboard, /admin)
 * lives inside the (member) route group, whose layout already establishes the
 * session and can therefore read the latch live from the row. Both guards then
 * decide from the same fresh value, which is what makes a loop impossible
 * rather than merely unlikely — see the loop argument on RESUME_PATH below.
 *
 * Next's own proxy documentation points the same way: "Always verify
 * authentication and authorization inside each Server Function rather than
 * relying on Proxy alone."
 */

/** The resume flow. Under /join so proxy.ts's existing "/join is exempt from the signed-in bounce" rule already covers it. */
export const RESUME_PATH = "/join/resume";

/** Where a released member lands when they arrived with no particular destination. */
export const DEFAULT_POST_SIGNUP_PATH = "/events";

/**
 * Member routes the gate does NOT apply to.
 *
 * /set-password: a member signing in with a setup code is sent here by
 * proxy.ts before anything else, and must be able to arrive. Gating it would
 * pit the two redirects against each other.
 *
 * /pending: the explanation shown to an account that cannot use the app yet.
 * Someone who needs that explanation should get it, not a signup wizard.
 */
const GATE_EXEMPT_PREFIXES = ["/set-password", "/pending"];

/**
 * Prefix match on the PATH only. proxy.ts stamps x-pathname without a query
 * string, so this is belt and braces — but a helper that silently stopped
 * matching because a "?" arrived would fail open, and failing open here means
 * letting an unfinished signup into the app.
 */
function hasPrefix(pathname: string, prefix: string): boolean {
  const path = pathname.split(/[?#]/)[0];
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** True when an unfinished signup should be redirected away from `pathname`. */
export function signupGateApplies(pathname: string): boolean {
  if (!pathname) return true;
  return !GATE_EXEMPT_PREFIXES.some((prefix) => hasPrefix(pathname, prefix));
}

/**
 * True for the resume flow itself. The (public) layout guard consults this to
 * leave it alone: that guard bounces signed-in users off public pages, and a
 * resuming user IS signed in, so without this exemption the gate would send
 * them to /join/resume and the guard would send them straight back to /events
 * — the same class of bug the wizard itself already carries an exemption for.
 */
export function isResumePath(pathname: string): boolean {
  return hasPrefix(pathname, RESUME_PATH);
}

/**
 * `?callbackUrl=` for a gate redirect, so the destination survives the detour.
 * Only same-site absolute paths are ever carried — an off-site or
 * protocol-relative value would make this an open redirect.
 */
export function resumeUrlFor(pathname: string): string {
  if (!isSafeCallback(pathname)) return RESUME_PATH;
  return `${RESUME_PATH}?callbackUrl=${encodeURIComponent(pathname)}`;
}

/** A callbackUrl this app is willing to send a browser to: same-site, absolute, and not the resume flow itself. */
export function isSafeCallback(value: string | null | undefined): boolean {
  if (!value) return false;
  if (!value.startsWith("/")) return false;
  // "//host" and "/\host" are both protocol-relative off-site URLs.
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  return !isResumePath(value);
}

/** Where to release a member once signup is finished. */
export function postSignupDestination(callbackUrl: string | null | undefined): string {
  return isSafeCallback(callbackUrl) ? callbackUrl! : DEFAULT_POST_SIGNUP_PATH;
}

/**
 * Org resolution (Part 2/6). The `org` cookie stores the org's id directly
 * (set by `/` or `/org/[slug]`) — reading it is never itself a DB call;
 * callers that also need the slug/name/logo fetch the Org row explicitly via
 * repo.getOrgById. src/proxy.ts reads the same cookie name directly off the
 * request instead of importing requireOrgContext()/setOrgCookie() here —
 * next/navigation's redirect() throws a Server-Component-shaped error that
 * doesn't apply in Proxy, which builds its own NextResponse.redirect instead.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const ORG_COOKIE = "org";
const ORG_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function setOrgCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: ORG_COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

export async function getOrgIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(ORG_COOKIE)?.value ?? null;
}

export interface OrgContext {
  orgId: string;
}

/**
 * For Server Components/Actions/Route Handlers that need an org and have
 * nowhere sensible to send someone without one — redirects to "/" per Part 6
 * ("If the org cookie is missing, send them to / to choose first").
 */
export async function requireOrgContext(): Promise<OrgContext> {
  const orgId = await getOrgIdFromCookie();
  if (!orgId) redirect("/");
  return { orgId };
}

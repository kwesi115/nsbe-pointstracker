import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { assertRequiredEnv } from "@/lib/env";
import { GUEST_PASS_COOKIE, verifyGuestPassValue } from "@/lib/guest-pass";
import { ORG_COOKIE } from "@/lib/org";

const PROTECTED_PREFIXES = ["/events", "/dashboard", "/account", "/leaderboard", "/admin"];
const GUEST_PREFIX = "/guest";
// Both need to know which org they're acting against before they render.
const ORG_REQUIRED_PREFIXES = ["/signin", "/join"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function isGuestPath(pathname: string): boolean {
  return pathname === GUEST_PREFIX || pathname.startsWith(`${GUEST_PREFIX}/`);
}

function isOrgRequiredPath(pathname: string): boolean {
  return ORG_REQUIRED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  assertRequiredEnv();

  const { pathname, search } = request.nextUrl;

  // Stamped on every request so (public)/layout.tsx can special-case "/"
  // without a pathname prop — layouts don't get one, only pages do, and that
  // check has to run before any specific page under the group renders.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  // getToken() only decrypts the session cookie directly — unlike auth(), it does NOT
  // run our jwt()/session() callbacks, so it never touches the workbook. That's the
  // point: keep this boundary check cheap, and leave the eboard check to
  // lib/session.ts server-side.
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.nextUrl.protocol === "https:",
  });

  const rawGuestPass = request.cookies.get(GUEST_PASS_COOKIE)?.value;
  const guestPass = verifyGuestPassValue(rawGuestPass);

  // A member session always wins (Part 3/7) — if both cookies are present,
  // every response built below drops the guest_pass before it goes out, and
  // the request is handled purely as an authenticated one.
  const dropGuestPass = Boolean(token && rawGuestPass);

  function next(): NextResponse {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    if (dropGuestPass) response.cookies.delete(GUEST_PASS_COOKIE);
    return response;
  }

  function redirectTo(url: string | URL): NextResponse {
    const response = NextResponse.redirect(new URL(url, request.url));
    if (dropGuestPass) response.cookies.delete(GUEST_PASS_COOKIE);
    return response;
  }

  if (token) {
    // A signed-in member has no business on the entry, sign-in, or guest
    // surface — send them into the real app instead (Part 2/4). /join is
    // deliberately excluded: the join wizard signs the user in immediately
    // after step 3 (account creation), so steps 4-8 run as authenticated
    // Server Action POSTs to this same route. Bouncing those to /events here
    // would silently kill the wizard mid-signup.
    if (pathname === "/signin" || isGuestPath(pathname)) {
      return redirectTo("/events");
    }

    if (!isProtected(pathname)) {
      return next();
    }

    // A session minted from a setup code can't do anything else — it can't
    // register for an event on a setup code. Send it to /set-password instead,
    // preserving where they were headed so it isn't lost after they finish.
    if (token.mustChangePassword) {
      const setPasswordUrl = new URL("/set-password", request.url);
      setPasswordUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
      return redirectTo(setPasswordUrl);
    }

    // PENDING/SUSPENDED members can sign in and see their dashboard/leaderboard,
    // but not register for events — show the explanatory /pending page instead
    // of a bare redirect loop or a silent 403. This is a UX hint only; the real
    // boundary is the fresh DB status check inside registerForEvent().
    if ((pathname === "/events" || pathname.startsWith("/events/")) && token.status !== "active") {
      return redirectTo("/pending");
    }

    return next();
  }

  // No session past this point — a valid guest_pass satisfies /guest/* only,
  // and redirects a protected-route hit to /guest/events instead of /signin
  // (Part 4). Nothing below reads a guest_pass as if it were a session.
  if (isProtected(pathname)) {
    if (guestPass) {
      return redirectTo("/guest/events");
    }
    const signInUrl = new URL("/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${search}`);
    return redirectTo(signInUrl);
  }

  if (isGuestPath(pathname)) {
    // /guest/join itself issues the pass, so it's the one guest path that
    // never requires one — but it still needs to know which org's GUEST code
    // to check against, same as /signin and /join below.
    if (pathname === "/guest/join") {
      if (!request.cookies.get(ORG_COOKIE)?.value) {
        return redirectTo("/");
      }
      return next();
    }
    if (!guestPass) {
      return redirectTo("/guest/join");
    }
    return next();
  }

  if (isOrgRequiredPath(pathname) && !request.cookies.get(ORG_COOKIE)?.value) {
    return redirectTo("/");
  }

  return next();
}

// Runs on everything except the auth API routes, Next internals, and static assets —
// isProtected()/isGuestPath() above decide which of those requests actually need
// a session or a guest pass.
export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon\\.ico).*)"],
};

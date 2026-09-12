import { headers } from "next/headers";
import { redirect } from "next/navigation";
import MemberNav from "@/components/MemberNav";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/session";
import { resumeUrlFor, signupGateApplies } from "@/lib/signup-routes";

/**
 * Shared chrome for every member route — full nav, user menu, and the real
 * (not just Proxy's cookie-shaped) session check (Part 1/4). proxy.ts already
 * bounces an unauthenticated request before it gets here; this is the
 * defense-in-depth layer that doesn't trust a cookie shape alone.
 *
 * The projector display (src/app/admin/events/[id]/display) lives outside
 * this route group deliberately, so it gets only the bare root layout: no
 * nav, no padding, full control of the screen for the wall.
 *
 * THE SIGNUP GATE lives here rather than in proxy.ts, and that placement is
 * deliberate — see lib/signup-routes.ts for the full argument. Short version:
 * every protected prefix (/events, /dashboard, /account, /leaderboard, /admin)
 * is inside this route group, this layout already establishes the session, and
 * the flag it reads is re-read from the database on every session check. Proxy
 * can only see the JWT, whose copy of that flag would go stale the instant
 * signup finished — and a stale copy here is exactly a redirect loop.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      redirect("/signin");
    }
    throw err;
  }

  // An account that hasn't finished signing up doesn't get into the app. It is
  // sent back to where it left off instead, carrying where it was going so the
  // destination isn't lost (see /join/resume, which honours callbackUrl).
  //
  // /set-password and /pending are exempt: a member holding a setup code must
  // reach /set-password first (proxy.ts sends them there, and gating it here
  // would fight that), and /pending is the explanation for an account that
  // cannot use the app yet at all.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (!session.user.signupComplete && signupGateApplies(pathname)) {
    redirect(resumeUrlFor(pathname));
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <MemberNav session={session} />
      {/* pb-bottom-nav clears MemberBottomNav's fixed mobile tab bar — see globals.css. No-op at md: and up, where that bar is hidden. */}
      <div className="pb-bottom-nav flex flex-1 flex-col md:pb-0">{children}</div>
    </div>
  );
}

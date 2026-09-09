import Link from "next/link";
import type { Session } from "next-auth";
import { signOutAction } from "@/app/(member)/actions";
import MemberAvatarMenu from "@/components/MemberAvatarMenu";
import MemberBottomNav from "@/components/MemberBottomNav";
import { hasPermission, getConfigValue, getMember } from "@/lib/repo";
import { isEboardOrAdmin } from "@/lib/session";

/**
 * Renders only inside (member)/layout.tsx, which already guaranteed a
 * session via requireSession() before this ever mounts (Part 6) — so unlike
 * the old SessionNav, nothing here branches on whether `session` is present.
 * If this component is on the page, the user is authenticated, full stop.
 *
 * Mobile-first: the base layout here is a compact top bar (chapter name +
 * avatar menu) plus MemberBottomNav's fixed tab bar. `md:` classes are the
 * only thing that switches to the wider inline-nav header — nothing here is
 * a separate "mobile stylesheet," it's the same header at every width.
 */
export default async function MemberNav({ session }: { session: Session }) {
  const orgId = session.user.orgId;
  const eboardOrAdmin = isEboardOrAdmin(session.user.role);
  const [chapterName, member, canVerify] = await Promise.all([
    getConfigValue(orgId, "CHAPTER_NAME", "NSBE"),
    getMember(orgId, session.user.email),
    eboardOrAdmin ? Promise.resolve(false) : hasPermission(orgId, session.user.email, "verifications_write"),
  ]);
  const firstName = member?.firstName || session.user.name?.split(" ")[0] || "";
  const adminHref = eboardOrAdmin ? "/admin" : canVerify ? "/admin/verifications" : null;
  const adminLabel = eboardOrAdmin ? "Admin" : "Verifications";

  return (
    <>
      <header className="pt-safe-top z-[var(--z-header)] flex items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3 md:px-6 print:hidden">
        <Link href="/events" className="min-w-0 truncate font-display text-base font-bold text-ink">
          {chapterName}
        </Link>

        {/* Desktop only — the four primary destinations plus Admin/Verifications inline, same as the mobile bottom bar's four but with a fifth link that has no room down there. */}
        <nav className="hidden items-center gap-4 text-sm font-medium text-muted md:flex">
          <Link href="/events" className="min-h-11 flex items-center hover:text-ink">
            Events
          </Link>
          <Link href="/dashboard" className="min-h-11 flex items-center hover:text-ink">
            Dashboard
          </Link>
          <Link href="/account" className="min-h-11 flex items-center hover:text-ink">
            Account
          </Link>
          <Link href="/leaderboard" className="min-h-11 flex items-center hover:text-ink">
            Leaderboard
          </Link>
          {adminHref ? (
            <Link href={adminHref} className="min-h-11 flex items-center hover:text-ink">
              {adminLabel}
            </Link>
          ) : null}
        </nav>

        {/* Desktop only — plain-text identity + sign out. Mobile gets the same two things behind the avatar menu instead, since there's no room for them inline next to a wrapping nav. */}
        <div className="hidden items-center gap-3 text-sm text-muted md:flex">
          <span>{firstName ? `Hi, ${firstName}` : session.user.email}</span>
          <form action={signOutAction}>
            <button type="submit" className="min-h-11 px-1 font-medium text-ink underline underline-offset-2">
              Not you? Sign out
            </button>
          </form>
        </div>

        <div className="md:hidden">
          <MemberAvatarMenu firstName={firstName} email={session.user.email} adminHref={adminHref} adminLabel={adminLabel} />
        </div>
      </header>

      <MemberBottomNav />
    </>
  );
}

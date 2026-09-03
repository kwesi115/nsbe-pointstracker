import Link from "next/link";
import type { Session } from "next-auth";
import { signOutAction } from "@/app/(member)/actions";
import { getConfigValue, getMember } from "@/lib/repo";

/**
 * Renders only inside (member)/layout.tsx, which already guaranteed a
 * session via requireSession() before this ever mounts (Part 6) — so unlike
 * the old SessionNav, nothing here branches on whether `session` is present.
 * If this component is on the page, the user is authenticated, full stop.
 */
export default async function MemberNav({ session }: { session: Session }) {
  const orgId = session.user.orgId;
  const [chapterName, member] = await Promise.all([
    getConfigValue(orgId, "CHAPTER_NAME", "NSBE"),
    getMember(orgId, session.user.email),
  ]);
  const firstName = member?.firstName || session.user.name?.split(" ")[0] || "";
  const isEboardOrAdmin = session.user.role === "eboard" || session.user.role === "admin";

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-6 py-3 print:hidden">
      <div className="flex items-center gap-6">
        <Link href="/events" className="font-display text-base font-bold text-ink">
          {chapterName}
        </Link>
        <nav className="flex items-center gap-4 text-sm font-medium text-muted">
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
          {isEboardOrAdmin ? (
            <Link href="/admin" className="min-h-11 flex items-center hover:text-ink">
              Admin
            </Link>
          ) : null}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm text-muted">
        <span>{firstName ? `Hi, ${firstName}` : session.user.email}</span>
        <form action={signOutAction}>
          <button type="submit" className="min-h-11 px-1 font-medium text-ink underline underline-offset-2">
            Not you? Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

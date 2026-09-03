import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import type { Member } from "@/lib/types";

/**
 * Shown instead of the points/rank stat tiles and the points-over-time chart
 * when a member's attendance is real but not yet counting toward standings
 * (see lib/points.ts isEligible / Part 1 of the spec — self-reported, no
 * admin gate). Never a bare "0" — that reads as a bug, not a status. One
 * link into /account#membership, the actual place to fix it.
 */
export default function MembershipRequiredPanel({
  member,
  pendingPoints,
}: {
  member: Pick<Member, "duesPaidReported" | "nationalMemberReported"> | null;
  pendingPoints: number | null;
}) {
  const duesOutstanding = member?.duesPaidReported !== true;
  const nationalOutstanding = member?.nationalMemberReported !== true;
  const missing = [duesOutstanding ? "chapter dues" : null, nationalOutstanding ? "National NSBE membership" : null]
    .filter(Boolean)
    .join(" and ");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-amber bg-amber/10 px-4 py-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-ink">
        <AlertTriangle size={16} className="shrink-0 text-amber" aria-hidden="true" />
        Membership required
      </p>
      <p className="text-sm text-muted">
        Your attendance is being recorded, but points don&apos;t count toward the leaderboard until you report{" "}
        {missing} —{" "}
        <Link href="/account#membership" className="font-semibold text-signal underline underline-offset-2">
          report it now
        </Link>
        .
      </p>
      {pendingPoints !== null ? (
        <p className="numeric text-xs text-muted">{pendingPoints} point(s) pending, once reported.</p>
      ) : null}
    </div>
  );
}

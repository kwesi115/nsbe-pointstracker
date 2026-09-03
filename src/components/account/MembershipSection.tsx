"use client";

import { ExternalLink } from "lucide-react";
import { useTransition } from "react";
import { reportDuesAction, reportNationalAction } from "@/app/(member)/account/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import type { Member } from "@/lib/types";

type MembershipMember = Pick<
  Member,
  "duesPaidReported" | "duesVerifiedAt" | "nationalMemberReported" | "nationalVerifiedAt" | "membershipSeason"
>;

/**
 * The highest-value surface in the app for an ineligible member (Part 7):
 * what's missing, one link to fix it, one control to report it. A member
 * lands on the leaderboard the moment both are reported here — no admin
 * action, no waiting for the next event (see lib/repo.ts setDuesReported/
 * setNationalReported, the same rule registerForEvent applies at check-in).
 */
export default function MembershipSection({
  member,
  season,
  membershipSiteUrl,
  nationalMembershipUrl,
}: {
  member: MembershipMember;
  season: string;
  membershipSiteUrl: string;
  nationalMembershipUrl: string;
}) {
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  const seasonMatches = member.membershipSeason === season;
  const duesConfirmed = member.duesPaidReported === true && seasonMatches;
  const nationalConfirmed = member.nationalMemberReported === true && seasonMatches;
  const eligible = duesConfirmed && nationalConfirmed;

  function report(action: () => Promise<{ error: string | null }>, label: string) {
    startTransition(async () => {
      const result = await action();
      if (result.error) show(result.error, "error");
      else show(`${label} reported`);
    });
  }

  return (
    <section id="membership" className="scroll-mt-20 flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Membership</h2>
      <Card className={eligible ? "" : "border-amber bg-amber/10"}>
        <div className="flex flex-col gap-4">
          {!eligible ? (
            <p className="text-sm text-ink">You&apos;re on the leaderboard as soon as both are reported below — no waiting on E-Board.</p>
          ) : (
            <p className="text-sm font-medium text-signal">Both reported — you&apos;re on the leaderboard.</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 first:border-0 first:pt-0">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-ink">Chapter dues{season ? ` · ${season}` : ""}</p>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${duesConfirmed ? "font-semibold text-signal" : "text-muted"}`}>
                  {duesConfirmed ? "Reported ✓" : "Not reported"}
                </span>
                {member.duesVerifiedAt ? <Badge tone="signal">Verified</Badge> : null}
              </div>
            </div>
            {!duesConfirmed ? (
              <div className="flex items-center gap-3">
                {membershipSiteUrl ? (
                  <a
                    href={membershipSiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-signal underline underline-offset-2"
                  >
                    Pay dues
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : null}
                <Button type="button" onClick={() => report(reportDuesAction, "Dues")} disabled={isPending}>
                  Mark as paid
                </Button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-ink">National NSBE membership{season ? ` · ${season}` : ""}</p>
              <div className="flex items-center gap-2">
                <span className={`text-xs ${nationalConfirmed ? "font-semibold text-signal" : "text-muted"}`}>
                  {nationalConfirmed ? "Reported ✓" : "Not reported"}
                </span>
                {member.nationalVerifiedAt ? <Badge tone="signal">Verified</Badge> : null}
              </div>
            </div>
            {!nationalConfirmed ? (
              <div className="flex items-center gap-3">
                {nationalMembershipUrl ? (
                  <a
                    href={nationalMembershipUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-signal underline underline-offset-2"
                  >
                    NSBE.org
                    <ExternalLink size={12} aria-hidden="true" />
                  </a>
                ) : null}
                <Button type="button" onClick={() => report(reportNationalAction, "National membership")} disabled={isPending}>
                  Mark as reported
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </section>
  );
}

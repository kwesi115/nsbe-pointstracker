"use client";

import { Check, ExternalLink, Hand } from "lucide-react";
import { useState, useTransition } from "react";
import { reportDuesAction, reportNationalAction, updateProfileAction } from "@/app/(member)/account/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { claimState, type ClaimState } from "@/lib/claim-state";
import { coreField } from "@/lib/core-form";
import type { Member } from "@/lib/types";

type MembershipMember = Pick<
  Member,
  | "duesPaidReported"
  | "duesVerifiedAt"
  | "duesRevokedAt"
  | "duesRevokedNote"
  | "nationalMemberReported"
  | "nationalVerifiedAt"
  | "nationalRevokedAt"
  | "nationalRevokedNote"
  | "membershipSeason"
  | "nsbeMembershipId"
>;

/**
 * The member-facing half of the claim-state fix. This used to print
 * "Reported ✓" off duesPaidReported alone — the same check mark the roster
 * showed for a verified claim — which taught members their self-report had
 * been checked when nobody had looked at it. A self-report says
 * "Self-reported"; only an admin's verification earns a check.
 */
function ClaimLine({ state, note }: { state: ClaimState; note: string }) {
  if (state === "verified") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-signal">
        <Check size={14} aria-hidden="true" />
        Verified by E-Board
      </span>
    );
  }
  if (state === "revoked") {
    return (
      <span className="text-xs font-semibold text-alert">Revoked{note ? ` — ${note}` : ""}</span>
    );
  }
  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7a4d00]">
        <Hand size={14} aria-hidden="true" />
        Self-reported
      </span>
    );
  }
  return <span className="text-xs text-muted">Not reported</span>;
}

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
  const [nsbeMembershipId, setNsbeMembershipId] = useState(member.nsbeMembershipId);
  const { show } = useToast();

  // Editable whatever the national membership status is — including "Not
  // reported" — and never cleared by it. Blank is a valid saved value: it's
  // how a member removes an ID they entered by mistake.
  const nsbeIdDirty = nsbeMembershipId.trim() !== member.nsbeMembershipId.trim();

  function saveNsbeId() {
    startTransition(async () => {
      const result = await updateProfileAction({ nsbeMembershipId: nsbeMembershipId.trim() });
      if (result.error) show(result.error, "error");
      else show("NSBE Membership ID saved");
    });
  }

  const seasonMatches = member.membershipSeason === season;
  // "Confirmed" here means confirmed FOR THE LEADERBOARD — reported by the
  // member, current season. It is deliberately not verification: eligibility
  // is driven by the reported flags alone (see lib/points.ts isEligible), and
  // this fix must not change who is on the board. The claim STATE below is a
  // separate, honest statement about whether anyone has checked it.
  const duesConfirmed = member.duesPaidReported === true && seasonMatches;
  const nationalConfirmed = member.nationalMemberReported === true && seasonMatches;
  const eligible = duesConfirmed && nationalConfirmed;
  const duesState = claimState(member.duesPaidReported, member.duesVerifiedAt, member.duesRevokedAt);
  const nationalState = claimState(member.nationalMemberReported, member.nationalVerifiedAt, member.nationalRevokedAt);

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
                <ClaimLine state={duesState} note={member.duesRevokedNote} />
                {duesConfirmed ? <Badge tone="muted">Counts for the leaderboard</Badge> : null}
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
                <ClaimLine state={nationalState} note={member.nationalRevokedNote} />
                {nationalConfirmed ? <Badge tone="muted">Counts for the leaderboard</Badge> : null}
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

          <div className="border-t border-line pt-4">
            <Field label={coreField("nsbeMembershipId").label} help={coreField("nsbeMembershipId").helpText}>
              {(id, describedBy) => (
                <div className="flex flex-wrap items-start gap-3">
                  <input
                    id={id}
                    value={nsbeMembershipId}
                    onChange={(e) => setNsbeMembershipId(e.target.value)}
                    disabled={isPending}
                    aria-describedby={describedBy}
                    className={`${inputClass} flex-1 sm:max-w-xs`}
                  />
                  <Button type="button" onClick={saveNsbeId} disabled={isPending || !nsbeIdDirty}>
                    Save
                  </Button>
                </div>
              )}
            </Field>
          </div>
        </div>
      </Card>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { approveAction, revokeAction } from "@/app/(member)/admin/verifications/actions";
import RevokeDialog from "@/components/admin/RevokeDialog";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import type { Member } from "@/lib/types";

type MembershipMember = Pick<
  Member,
  | "email"
  | "duesPaidReported"
  | "duesReportedAt"
  | "duesVerifiedAt"
  | "duesRevokedAt"
  | "duesRevokedNote"
  | "nationalMemberReported"
  | "nationalVerifiedAt"
  | "nationalRevokedAt"
  | "nationalRevokedNote"
  | "membershipSeason"
>;

function stateOf(reported: boolean | null, verifiedAt: Date | null, revokedAt: Date | null): { label: string; tone: "signal" | "amber" | "alert" | "muted" } {
  if (revokedAt) return { label: "Revoked", tone: "alert" };
  if (verifiedAt) return { label: "Verified", tone: "signal" };
  if (reported === true) return { label: "Unverified", tone: "amber" };
  return { label: "Not reported", tone: "muted" };
}

/** Reported values with timestamps, verified/revoked state, and Verify/Revoke — same repo functions /admin/verifications uses (Part 5). Revoke requires a note and immediately removes the member from the leaderboard. */
export default function AdminMembershipPanel({ member, season }: { member: MembershipMember; season: string }) {
  const [revokeTab, setRevokeTab] = useState<"dues" | "national" | null>(null);
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  const dues = stateOf(member.duesPaidReported, member.duesVerifiedAt, member.duesRevokedAt);
  const national = stateOf(member.nationalMemberReported, member.nationalVerifiedAt, member.nationalRevokedAt);

  function verify(tab: "dues" | "national") {
    startTransition(async () => {
      const result = await approveAction(tab, member.email);
      if (result.error) show(result.error, "error");
      else show("Verified");
    });
  }

  function confirmRevoke(note: string) {
    if (!revokeTab) return;
    const tab = revokeTab;
    startTransition(async () => {
      const result = await revokeAction(tab, member.email, note);
      if (result.error) show(result.error, "error");
      else show("Revoked");
      setRevokeTab(null);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Table>
        <Thead>
          <th className={thClass}>Claim</th>
          <th className={thClass}>Reported</th>
          <th className={thClass}>State</th>
          <th className={thClass}>Season</th>
          <th className={thClass}></th>
        </Thead>
        <tbody>
          <tr className="border-b border-line">
            <td className={tdClass}>Dues</td>
            <td className={tdClass}>{member.duesReportedAt ? formatDateTime(member.duesReportedAt) : "—"}</td>
            <td className={tdClass}>
              <Badge tone={dues.tone}>{dues.label}</Badge>
              {member.duesRevokedNote ? <p className="mt-1 text-xs text-muted">{member.duesRevokedNote}</p> : null}
            </td>
            <td className={tdClass}>{member.membershipSeason || "—"}</td>
            <td className={tdClass}>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRevokeTab("dues")} disabled={isPending}>
                  Revoke
                </Button>
                <Button type="button" onClick={() => verify("dues")} disabled={isPending}>
                  Verify
                </Button>
              </div>
            </td>
          </tr>
          <tr className="last:border-0">
            <td className={tdClass}>National NSBE</td>
            <td className={tdClass}>{member.nationalMemberReported !== null ? "Reported" : "—"}</td>
            <td className={tdClass}>
              <Badge tone={national.tone}>{national.label}</Badge>
              {member.nationalRevokedNote ? <p className="mt-1 text-xs text-muted">{member.nationalRevokedNote}</p> : null}
            </td>
            <td className={tdClass}>{member.membershipSeason || "—"}</td>
            <td className={tdClass}>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setRevokeTab("national")} disabled={isPending}>
                  Revoke
                </Button>
                <Button type="button" onClick={() => verify("national")} disabled={isPending}>
                  Verify
                </Button>
              </div>
            </td>
          </tr>
        </tbody>
      </Table>
      <p className="text-xs text-muted">Current season: {season || "—"}</p>

      <RevokeDialog
        open={revokeTab !== null}
        title={`Revoke ${revokeTab === "dues" ? "dues" : "national membership"} claim?`}
        pending={isPending}
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTab(null)}
      />
    </div>
  );
}

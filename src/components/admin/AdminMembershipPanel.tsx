"use client";

import { useState } from "react";
import { approveAction, revokeAction, type VerificationActionState } from "@/app/(member)/admin/verifications/actions";
import ActionButton from "@/components/ui/ActionButton";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { CLAIM_STATE_LABEL, claimState, type ClaimState } from "@/lib/claim-state";
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
> & {
  /** Resolved from *VerifiedById by the page (see lib/repo.ts resolveVerifierNames). Empty when unknown — the panel then shows the date alone rather than inventing a verifier. */
  duesVerifiedByName: string;
  nationalVerifiedByName: string;
};

const TONE: Record<ClaimState, "signal" | "amber" | "alert" | "muted"> = {
  verified: "signal",
  pending: "amber",
  revoked: "alert",
  none: "muted",
};

const INITIAL_STATE: VerificationActionState = { error: null };

/** Reported values with timestamps, verified/revoked state, and Verify/Revoke — same repo functions /admin/verifications uses (Part 5). Revoke requires a note and immediately removes the member from the leaderboard. */
export default function AdminMembershipPanel({ member, season }: { member: MembershipMember; season: string }) {
  const [revokeTab, setRevokeTab] = useState<"dues" | "national" | null>(null);
  const { show } = useToast();

  const dues = claimState(member.duesPaidReported, member.duesVerifiedAt, member.duesRevokedAt);
  const national = claimState(member.nationalMemberReported, member.nationalVerifiedAt, member.nationalRevokedAt);

  function claimRow(tab: "dues" | "national") {
    return (
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setRevokeTab(tab)}>
          Revoke
        </Button>
        <ActionButton<VerificationActionState>
          action={approveAction}
          initialState={INITIAL_STATE}
          payload={{ tab, email: member.email }}
          label="Verify"
          onSuccess={() => show("Verified")}
          onError={(message) => show(message, "error")}
        />
      </div>
    );
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
              <Badge tone={TONE[dues]}>{CLAIM_STATE_LABEL[dues]}</Badge>
              {dues === "verified" ? (
                <p className="mt-1 text-xs text-muted">
                  {member.duesVerifiedByName ? `by ${member.duesVerifiedByName} · ` : ""}
                  {formatDateTime(member.duesVerifiedAt)}
                </p>
              ) : null}
              {member.duesRevokedNote ? <p className="mt-1 text-xs text-muted">{member.duesRevokedNote}</p> : null}
            </td>
            <td className={tdClass}>{member.membershipSeason || "—"}</td>
            <td className={tdClass}>{claimRow("dues")}</td>
          </tr>
          <tr className="last:border-0">
            <td className={tdClass}>National NSBE</td>
            <td className={tdClass}>{member.nationalMemberReported !== null ? "Reported" : "—"}</td>
            <td className={tdClass}>
              <Badge tone={TONE[national]}>{CLAIM_STATE_LABEL[national]}</Badge>
              {national === "verified" ? (
                <p className="mt-1 text-xs text-muted">
                  {member.nationalVerifiedByName ? `by ${member.nationalVerifiedByName} · ` : ""}
                  {formatDateTime(member.nationalVerifiedAt)}
                </p>
              ) : null}
              {member.nationalRevokedNote ? <p className="mt-1 text-xs text-muted">{member.nationalRevokedNote}</p> : null}
            </td>
            <td className={tdClass}>{member.membershipSeason || "—"}</td>
            <td className={tdClass}>{claimRow("national")}</td>
          </tr>
        </tbody>
      </Table>
      <p className="text-xs text-muted">Current season: {season || "—"}</p>

      {/* The shared dialog, with its required-note field — the same one
          /admin/verifications uses, rather than a second hand-rolled copy. */}
      <ConfirmDialog<VerificationActionState>
        open={revokeTab !== null}
        title={`Revoke ${revokeTab === "dues" ? "dues" : "national membership"} claim?`}
        description="This removes them from the leaderboard immediately and re-arms the question at their next check-in. Say why."
        confirmLabel="Revoke"
        tone="danger"
        action={revokeAction}
        initialState={INITIAL_STATE}
        payload={{ tab: revokeTab, email: member.email }}
        reason={{
          label: "Why",
          placeholder: "e.g. Payment record doesn't show this member",
          help: "Recorded against the claim and shown on this panel.",
        }}
        onCancel={() => setRevokeTab(null)}
        onSuccess={() => {
          show("Revoked");
          setRevokeTab(null);
        }}
      />
    </div>
  );
}

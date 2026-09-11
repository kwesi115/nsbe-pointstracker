"use client";

import Link from "next/link";
import { Check, Clock, Hand, X } from "lucide-react";
import { useState, useTransition } from "react";
import {
  bulkSetRoleAction,
  bulkVerifyDuesAction,
  bulkVerifyNationalAction,
} from "@/app/(member)/admin/members/actions";
import { tdClass, thClass, Thead } from "@/components/ui/Table";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EmptyValue } from "@/components/StatusIcon";
import { formatDateTime, memberDisplayName } from "@/lib/format";
import type { House } from "@/lib/houses";
import type { MemberWithStats } from "@/lib/repo";
import AccountStateBadge from "./AccountStateBadge";
import ApproveRejectButtons from "./ApproveRejectButtons";
import EboardPositionCell from "./EboardPositionCell";
import HouseCell from "./HouseCell";
import ResetPasswordButton from "./ResetPasswordButton";
import RoleSelect from "./RoleSelect";
import StatusIcon from "@/components/StatusIcon";
import ClaimStatus from "@/components/ClaimStatus";
import StatusBadge from "./StatusBadge";

const stickyNameClass = "sticky left-0 z-10 bg-surface";

/**
 * Above the roster so a sighted user and a screen reader agree on what each
 * glyph means. Split in two on purpose: the Dues and National columns are
 * CLAIMS with four states (what the member said vs. what an admin checked),
 * and the old single legend line — "Yes / verified" against one check mark —
 * is the sentence that made a self-report look like an audited fact.
 */
function StatusLegend() {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-muted">
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <li className="font-semibold text-ink">Dues &amp; National</li>
        <li className="flex items-center gap-1.5">
          <Hand size={14} className="text-[#7a4d00]" aria-hidden="true" />
          Self-reported, not yet verified
        </li>
        <li className="flex items-center gap-1.5">
          <Check size={14} className="text-signal" aria-hidden="true" />
          Verified by an admin
        </li>
        <li className="flex items-center gap-1.5">
          <X size={14} className="text-alert" aria-hidden="true" />
          Revoked
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true">—</span>
          Not reported
        </li>
      </ul>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5">
        <li className="font-semibold text-ink">Eligible, House &amp; Resume</li>
        <li className="flex items-center gap-1.5">
          <Check size={14} className="text-signal" aria-hidden="true" />
          Yes
        </li>
        <li className="flex items-center gap-1.5">
          <X size={14} className="text-muted" aria-hidden="true" />
          No
        </li>
        <li className="flex items-center gap-1.5">
          <Clock size={14} className="text-[#7a4d00]" aria-hidden="true" />
          Pending
        </li>
        <li className="flex items-center gap-1.5">
          <span aria-hidden="true">—</span>
          Not provided
        </li>
      </ul>
    </div>
  );
}

export default function MembersTable({
  members,
  houses,
  exportsEnabled,
}: {
  members: MemberWithStats[];
  houses: House[];
  /** Config.EXPORTS_ENABLED — hides "Export selected", whose endpoint is gated by the same flag. See lib/features.ts. */
  exportsEnabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === members.length ? new Set() : new Set(members.map((m) => m.email))));
  }

  function runBulk(fn: (emails: string[]) => Promise<{ error: string | null }>, label: string) {
    const emails = Array.from(selected);
    startTransition(async () => {
      const result = await fn(emails);
      if (result.error) show(result.error, "error");
      else {
        show(`${label} — ${emails.length} member(s)`);
        setSelected(new Set());
      }
    });
  }

  async function exportSelected() {
    const emails = Array.from(selected);
    const res = await fetch("/api/admin/export/members/csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ emails }),
    });
    if (!res.ok) {
      // The endpoint answers with JSON { code, message } on a 403 — surface the
      // server's own reason (see lib/api.ts withApiErrors) rather than a
      // generic failure that hides "exports are turned off right now".
      const body = await res.json().catch(() => null);
      show(typeof body?.message === "string" ? body.message : "Export failed", "error");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "members.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  if (members.length === 0) {
    return <EmptyState title="No members match" description="Try a different search or filter." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <StatusLegend />

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
          <p className="text-sm text-ink">{selected.size} selected</p>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => runBulk(bulkVerifyDuesAction, "Verified dues")}>
              Verify dues
            </Button>
            <Button type="button" variant="secondary" disabled={isPending} onClick={() => runBulk(bulkVerifyNationalAction, "Verified national")}>
              Verify national
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => runBulk((emails) => bulkSetRoleAction(emails, "eboard"), "Promoted to E-Board")}
            >
              Promote to E-Board
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => runBulk((emails) => bulkSetRoleAction(emails, "general"), "Demoted to General")}
            >
              Demote to General
            </Button>
            {exportsEnabled ? (
              <Button type="button" onClick={exportSelected} disabled={isPending}>
                Export selected
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <Thead>
            <th className={`${thClass} ${stickyNameClass} w-10`}>
              <input type="checkbox" checked={selected.size === members.length} onChange={toggleAll} aria-label="Select all" className="h-4 w-4" />
            </th>
            <th className={`${thClass} ${stickyNameClass} min-w-[170px]`}>Name</th>
            <th className={`${thClass} min-w-[210px]`}>Email</th>
            <th className={`${thClass} min-w-[130px]`}>Classification</th>
            <th className={`${thClass} min-w-[140px]`}>Major</th>
            <th className={`${thClass} min-w-[110px]`}>NSBE ID</th>
            <th className={`${thClass} min-w-[80px]`}>Points</th>
            <th className={`${thClass} min-w-[80px]`}>Events</th>
            <th className={`${thClass} min-w-[90px]`}>Eligible</th>
            <th className={`${thClass} min-w-[90px]`}>Dues</th>
            <th className={`${thClass} min-w-[90px]`}>National</th>
            <th className={`${thClass} min-w-[170px]`}>House</th>
            <th className={`${thClass} min-w-[90px]`}>Resume</th>
            <th className={`${thClass} min-w-[140px]`}>Role</th>
            <th className={`${thClass} min-w-[170px]`}>Position</th>
            <th className={`${thClass} min-w-[150px]`}>Status</th>
            <th className={`${thClass} min-w-[110px]`}>Account</th>
            <th className={`${thClass} min-w-[170px]`}>Last active</th>
            <th className={`${thClass} min-w-[130px]`}>Password</th>
          </Thead>
          <tbody>
            {members.map((m) => {
              const name = memberDisplayName(m.firstName, m.lastName, m.email);
              return (
                <tr key={m.email} className="border-b border-line last:border-0">
                  <td className={`${tdClass} ${stickyNameClass}`}>
                    <input
                      type="checkbox"
                      checked={selected.has(m.email)}
                      onChange={() => toggle(m.email)}
                      aria-label={`Select ${name}`}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className={`${tdClass} ${stickyNameClass}`}>
                    <Link href={`/admin/members/${m.id}`} className="font-medium text-signal underline underline-offset-2">
                      {name}
                    </Link>
                  </td>
                  <td className={tdClass}>{m.email}</td>
                  <td className={tdClass}>{m.classification || <EmptyValue />}</td>
                  <td className={tdClass}>{m.major || <EmptyValue />}</td>
                  <td className={tdClass}>{m.nsbeMembershipId || <EmptyValue />}</td>
                  <td className={`${tdClass} numeric`}>{m.points}</td>
                  <td className={`${tdClass} numeric`}>{m.events}</td>
                  <td className={tdClass}>
                    <StatusIcon value={m.eligible} labels={{ yes: "Eligible", no: "Ineligible" }} />
                  </td>
                  <td className={tdClass}>
                    <ClaimStatus
                      claimLabel="Dues"
                      state={m.duesState}
                      verifiedAt={m.duesVerifiedAt}
                      verifiedByName={m.duesVerifiedByName}
                      revokedNote={m.duesRevokedNote}
                    />
                  </td>
                  <td className={tdClass}>
                    <ClaimStatus
                      claimLabel="National membership"
                      state={m.nationalState}
                      verifiedAt={m.nationalVerifiedAt}
                      verifiedByName={m.nationalVerifiedByName}
                      revokedNote={m.nationalRevokedNote}
                    />
                  </td>
                  <td className={tdClass}>
                    <HouseCell member={m} houses={houses} />
                  </td>
                  <td className={tdClass}>
                    {m.resumeFileId ? (
                      <a href={`/api/files/${m.resumeFileId}`} target="_blank" rel="noopener noreferrer" className="text-signal underline underline-offset-2">
                        View
                      </a>
                    ) : (
                      <EmptyValue label="No resume on file" />
                    )}
                  </td>
                  <td className={tdClass}>
                    <RoleSelect email={m.email} role={m.role} />
                  </td>
                  <td className={tdClass}>
                    <EboardPositionCell member={m} />
                  </td>
                  <td className={tdClass}>
                    <div className="flex flex-col items-start gap-1.5">
                      <StatusBadge status={m.status} />
                      {m.status === "pending" ? <ApproveRejectButtons email={m.email} /> : null}
                    </div>
                  </td>
                  <td className={tdClass}>
                    <AccountStateBadge state={m.accountState} />
                  </td>
                  <td className={tdClass}>{m.lastActiveAt ? formatDateTime(m.lastActiveAt) : <EmptyValue />}</td>
                  <td className={tdClass}>
                    <ResetPasswordButton email={m.email} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { revokeAdjustmentAction, type AdjustmentActionState } from "@/app/(member)/admin/members/points-actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, formatSigned } from "@/lib/format";
import type { MemberPointsPanel, PointAdjustmentRow } from "@/lib/repo";
import AdjustPointsDialog, { type AdjustableEvent } from "./AdjustPointsDialog";

const INITIAL_STATE: AdjustmentActionState = { error: null };

/**
 * The full point breakdown on /admin/members/[id], with every adjustment ever
 * made to this member — amount, reason, who, when, linked event — and a Revoke
 * on each one still in force. All TRUE values: a total below zero reads as
 * negative here, because this is where an admin needs to see it.
 */
export default function PointsPanel({
  email,
  panel,
  events,
  canAdjust,
}: {
  email: string;
  panel: MemberPointsPanel;
  events: AdjustableEvent[];
  /** Holds points_write — see lib/access.ts. Without it the panel is read-only. */
  canAdjust: boolean;
}) {
  const { show } = useToast();
  const [adjusting, setAdjusting] = useState(false);
  const [revoking, setRevoking] = useState<PointAdjustmentRow | null>(null);
  const b = panel.breakdown;

  const lines: Array<{ label: string; value: number }> = [
    { label: "Event points", value: b.eventPoints },
    { label: "NSBE Week bonus", value: b.nsbeWeekBonus },
    { label: "Game bonuses", value: b.gameBonus },
    { label: "Monthly champion", value: b.monthlyChampionBonus },
    { label: "Manual bonus", value: b.manualBonus },
    { label: "Adjustments", value: b.adjustments },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-border bg-surface p-4">
        <dl className="flex min-w-60 flex-col gap-1.5 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex items-center justify-between gap-6">
              <dt className="text-muted">{l.label}</dt>
              <dd className={`numeric font-medium ${l.value < 0 ? "text-alert" : "text-foreground"}`}>
                {l.label === "Adjustments" ? formatSigned(l.value) : l.value}
              </dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-6 border-t border-border pt-2">
            <dt className="font-semibold text-foreground">Season total {panel.season ? `(${panel.season})` : ""}</dt>
            <dd className={`numeric text-lg font-bold ${b.total < 0 ? "text-alert" : "text-foreground"}`}>{b.total}</dd>
          </div>
        </dl>

        <div className="flex flex-col items-end gap-2 text-sm">
          <p className="text-foreground">
            {panel.rank !== null ? (
              <>
                Rank <span className="numeric font-semibold">#{panel.rank}</span>
                <span className="text-muted"> of {panel.totalRanked}</span>
              </>
            ) : (
              <span className="text-muted">
                {panel.role !== "general" ? "Not on the member leaderboard (role)" : "Not on the leaderboard until eligible"}
              </span>
            )}
          </p>
          {canAdjust ? (
            <Button type="button" variant="secondary" onClick={() => setAdjusting(true)}>
              Adjust points
            </Button>
          ) : null}
        </div>
      </div>

      {b.total < 0 ? (
        <p className="text-xs text-muted">
          This member&apos;s true total is below zero. They see 0 on the leaderboard and their dashboard; the true value is
          kept here and in the data.
        </p>
      ) : null}
      {panel.role === "eboard" ? (
        <p className="text-xs text-torch-strong">
          E-Board member: adjustments apply to the member track only and have no effect on the internal E-Board board.
        </p>
      ) : null}

      {panel.adjustments.length === 0 ? (
        <p className="text-sm text-muted">No adjustments.</p>
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>Amount</th>
            <th className={thClass}>Reason</th>
            <th className={thClass}>By</th>
            <th className={thClass}>When</th>
            <th className={thClass}>Event</th>
            <th className={thClass}>Status</th>
            <th className={thClass}></th>
          </Thead>
          <tbody>
            {panel.adjustments.map((a) => (
              <tr key={a.id} className="border-b border-border last:border-0">
                <td className={`${tdClass} numeric font-semibold ${a.counts ? (a.points < 0 ? "text-alert" : "text-foreground") : "text-muted line-through"}`}>
                  {formatSigned(a.points)}
                </td>
                <td className={tdClass}>{a.reason}</td>
                <td className={tdClass}>{a.awardedByName || "—"}</td>
                <td className={tdClass}>{formatDateTime(a.awardedAt)}</td>
                <td className={tdClass}>{a.relatedEventName || "—"}</td>
                <td className={tdClass}>
                  {a.revokedAt ? (
                    <span className="text-xs text-muted">
                      Revoked {formatDateTime(a.revokedAt)}
                      {a.revokedByName ? ` by ${a.revokedByName}` : ""}
                      {a.revokeNote ? `: ${a.revokeNote}` : ""}
                    </span>
                  ) : a.counts ? (
                    <Badge tone="signal">Counts</Badge>
                  ) : (
                    <Badge tone="muted">{a.season ? `${a.season} — not this season` : "No season"}</Badge>
                  )}
                </td>
                <td className={tdClass}>
                  {canAdjust && !a.revokedAt ? (
                    <button
                      type="button"
                      onClick={() => setRevoking(a)}
                      className="text-xs font-semibold text-alert underline underline-offset-2"
                    >
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <AdjustPointsDialog
        open={adjusting}
        emails={[email]}
        events={events}
        onClose={() => setAdjusting(false)}
        onSuccess={() => {
          show("Adjustment recorded");
          setAdjusting(false);
        }}
      />

      {revoking ? (
        <ConfirmDialog<AdjustmentActionState>
          open
          title={`Revoke this ${formatSigned(revoking.points)} adjustment?`}
          description={
            <>
              {revoking.counts
                ? `Their season total goes ${revoking.points < 0 ? "up" : "down"} by ${Math.abs(revoking.points)}, back to exactly what it would have been without it.`
                : "It isn't counting toward this season, so no total changes — this only records that it was withdrawn."}{" "}
              The adjustment stays on record, marked revoked.
            </>
          }
          confirmLabel="Revoke adjustment"
          tone="danger"
          action={revokeAdjustmentAction}
          initialState={INITIAL_STATE}
          payload={{ id: revoking.id }}
          reason={{ label: "Why are you revoking it?", placeholder: "Entered on the wrong member…" }}
          onCancel={() => setRevoking(null)}
          onSuccess={() => {
            show("Adjustment revoked");
            setRevoking(null);
          }}
        />
      ) : null}
    </div>
  );
}

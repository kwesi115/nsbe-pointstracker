"use client";

import { useEffect, useState, useTransition } from "react";
import {
  adjustPointsAction,
  previewAdjustmentAction,
  type AdjustmentActionState,
} from "@/app/(member)/admin/members/points-actions";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Field, { inputClass, selectClass, textareaClass } from "@/components/ui/Field";
import { formatSigned, pluralize } from "@/lib/format";
import type { AdjustmentImpact } from "@/lib/repo";

/** Mirrors lib/repo.ts validateAdjustment (10+ characters, more than one word) — the server enforces it; this only keeps Confirm honest. */
const REASON_MIN = 10;
function reasonProblem(reason: string): string | null {
  const t = reason.trim();
  if (t.length === 0) return null;
  if (t.length < REASON_MIN) return `${REASON_MIN - t.length} more character(s)`;
  if (!/\S\s+\S/.test(t)) return "Say what happened — one word isn't a reason";
  return null;
}
const PREVIEW_DEBOUNCE_MS = 300;
const INITIAL_STATE: AdjustmentActionState = { error: null };
/** Bulk previews list this many rows, then "and N more". */
const PREVIEW_ROWS = 8;

export interface AdjustableEvent {
  eventId: string;
  name: string;
}

function rankText(rank: number | null): string {
  return rank === null ? "not ranked" : `#${rank}`;
}

const OFF_BOARD_COPY: Record<AdjustmentImpact["offBoard"][number]["why"], string> = {
  eboard:
    "is on the E-Board. Adjustments apply to the member track only — this has no effect on the internal E-Board board. It would only count on the member leaderboard if they were moved back to General.",
  admin: "is an Admin. Admins aren't on either leaderboard, so this won't show anywhere until their role changes.",
  guest: "is a guest account and isn't on any leaderboard.",
  ineligible:
    "hasn't reported dues and national membership for this season. The adjustment is recorded and counts once they do — same as their other points.",
};

/**
 * "Adjust points" — one member from their page, or every selected member from
 * the directory, with one shared reason. The confirmation shows the impact
 * BEFORE anything is written: current → new total and current → projected rank
 * for each target (lib/repo.ts previewPointAdjustment), so an admin sees that a
 * -5 drops someone from 3rd to 9th before committing to it.
 *
 * Totals here are the TRUE values and may be negative — this is an admin
 * surface. Members themselves never see below 0 (lib/points.ts displayTotal).
 */
export default function AdjustPointsDialog({
  open,
  emails,
  events = [],
  onClose,
  onSuccess,
}: {
  open: boolean;
  emails: string[];
  /** Offered as the optional "related event" link. Informational only. */
  events?: AdjustableEvent[];
  onClose: () => void;
  onSuccess: (adjusted: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [relatedEventId, setRelatedEventId] = useState("");
  const [impact, setImpact] = useState<AdjustmentImpact | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, startPreview] = useTransition();

  // A fresh form on every opening — adjusted during render on the prop
  // transition, same pattern as ConfirmDialog itself, so a reopened dialog
  // never flashes the last adjustment's numbers.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAmount("");
      setReason("");
      setRelatedEventId("");
      setImpact(null);
      setPreviewError(null);
    }
  }

  const points = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isInteger(points) && points !== 0;
  const emailsKey = emails.join("|");

  useEffect(() => {
    if (!open || !validAmount) return;
    const handle = setTimeout(() => {
      startPreview(async () => {
        const result = await previewAdjustmentAction(emailsKey.split("|"), points);
        setImpact(result.impact);
        setPreviewError(result.error);
      });
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [open, validAmount, points, emailsKey]);

  // Only an impact computed for the amount currently in the box may be confirmed.
  const currentImpact = impact && validAmount && impact.points === points ? impact : null;
  const bulk = emails.length > 1;

  return (
    <ConfirmDialog<AdjustmentActionState>
      open={open}
      title={bulk ? `Adjust points for ${pluralize(emails.length, "member")}` : "Adjust points"}
      description="Adds a signed adjustment to this season's total. The attendance record is never edited, and the adjustment can be revoked later."
      confirmLabel={validAmount ? `Apply ${formatSigned(points)}` : "Apply"}
      tone={validAmount && points < 0 ? "danger" : "primary"}
      action={adjustPointsAction}
      initialState={INITIAL_STATE}
      confirmDisabled={!currentImpact || loading || reason.trim() === "" || reasonProblem(reason) !== null || currentImpact.count === 0}
      onCancel={onClose}
      onSuccess={(state) => onSuccess(state.adjusted ?? emails.length)}
    >
      {emails.map((email) => (
        <input key={email} type="hidden" name="emails" value={email} />
      ))}

      <Field label="Points" required help="Positive adds, negative takes away. Whole numbers only.">
        {(id, describedBy) => (
          <input
            id={id}
            name="points"
            type="number"
            step={1}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-describedby={describedBy}
            placeholder="-5"
            required
            className={inputClass}
          />
        )}
      </Field>

      <Field
        label="Reason"
        required
        help={`At least ${REASON_MIN} characters, saying what happened. Recorded against your account in the admin log${bulk ? " for every selected member" : ""}.`}
        error={reasonProblem(reason)}
      >
        {(id, describedBy) => (
          <textarea
            id={id}
            name="adjustmentReason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-describedby={describedBy}
            placeholder="Checked in for a friend at the Oct 3 GBM — confirmed by the host"
            required
            className={textareaClass}
          />
        )}
      </Field>

      {events.length > 0 ? (
        <Field label="Related event" help="Optional. A note for the audit trail — it doesn't change that event's counts.">
          {(id, describedBy) => (
            <select
              id={id}
              name="relatedEventId"
              value={relatedEventId}
              onChange={(e) => setRelatedEventId(e.target.value)}
              aria-describedby={describedBy}
              className={selectClass}
            >
              <option value="">None</option>
              {events.map((e) => (
                <option key={e.eventId} value={e.eventId}>
                  {e.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}

      <ImpactSummary impact={currentImpact} loading={loading || (validAmount && !currentImpact && !previewError)} error={previewError} validAmount={validAmount} />
    </ConfirmDialog>
  );
}

function ImpactSummary({
  impact,
  loading,
  error,
  validAmount,
}: {
  impact: AdjustmentImpact | null;
  loading: boolean;
  error: string | null;
  validAmount: boolean;
}) {
  if (!validAmount) return <p className="text-sm text-muted">Enter an amount to see the impact before confirming.</p>;
  if (error) return <p className="text-sm font-medium text-alert">{error}</p>;
  if (loading || !impact) return <p className="text-sm text-muted">Working out the impact…</p>;

  const rows = impact.members.slice(0, PREVIEW_ROWS);
  const goesNegative = impact.members.some((m) => m.newTotal < 0);

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-surface-raised px-3 py-2 text-sm">
      {impact.count > 1 ? (
        <p className="text-foreground">
          <span className="numeric font-semibold">{impact.count}</span> members ·{" "}
          <span className="numeric font-semibold">{formatSigned(impact.totalPointsAffected)}</span> points in total
        </p>
      ) : null}

      <ul className="flex flex-col gap-1">
        {rows.map((m) => (
          <li key={m.email} className="text-foreground">
            {impact.count > 1 ? <span className="font-medium">{m.name}: </span> : null}
            Total <span className="numeric font-semibold">{m.currentTotal}</span> →{" "}
            <span className="numeric font-semibold">{m.newTotal}</span>
            {" · "}
            {m.currentRank === null ? (
              <span className="text-muted">not on the member leaderboard</span>
            ) : (
              <>
                Rank <span className="numeric font-semibold">{rankText(m.currentRank)}</span> →{" "}
                <span className="numeric font-semibold">{rankText(m.projectedRank)}</span>
                <span className="text-muted"> of {impact.totalRanked}</span>
              </>
            )}
          </li>
        ))}
      </ul>
      {impact.members.length > rows.length ? (
        <p className="text-xs text-muted">and {impact.members.length - rows.length} more</p>
      ) : null}

      {impact.offBoard.map((o) => (
        <p key={o.email} className="text-xs text-torch-strong">
          {o.name} {OFF_BOARD_COPY[o.why]}
        </p>
      ))}
      {goesNegative ? (
        <p className="text-xs text-muted">
          A total below zero is kept as-is here and on every admin page; members see 0 on the leaderboard and their dashboard.
        </p>
      ) : null}
      {impact.notFound.length > 0 ? (
        <p className="text-xs font-medium text-alert">Not found (in the trash, or removed): {impact.notFound.join(", ")}</p>
      ) : null}
    </div>
  );
}

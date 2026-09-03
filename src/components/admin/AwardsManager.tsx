"use client";

import { useActionState, useState, useTransition } from "react";
import {
  calculateChampionsAction,
  createManualAwardAction,
  previewChampionsAction,
  revokeAwardAction,
  type AwardActionState,
  type ChampionPreviewResult,
} from "@/app/(member)/admin/awards/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";
import type { PointAward } from "@/lib/types";

const INITIAL_MANUAL_STATE: AwardActionState = { error: null };

function RevokeControl({ award }: { award: PointAward }) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();

  if (award.revokedAt) {
    return <span className="text-xs text-muted">Revoked{award.revokeNote ? `: ${award.revokeNote}` : ""}</span>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs font-semibold text-alert underline underline-offset-2">
        Revoke
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Reason for revoking (required)"
        className={`${inputClass} text-xs`}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="danger"
          disabled={isPending || !note.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await revokeAwardAction(award.id, note);
              if (result.error) show(result.error, "error");
              else show("Award revoked");
              setOpen(false);
            })
          }
        >
          Confirm revoke
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<PointAward["kind"], string> = {
  game_competition: "Game / competition",
  monthly_champion: "Monthly champion",
  manual: "Manual",
};

function AwardsTable({ awards }: { awards: PointAward[] }) {
  return (
    <Table>
      <Thead>
        <th className={thClass}>Member</th>
        <th className={thClass}>Kind</th>
        <th className={thClass}>Points</th>
        <th className={thClass}>Reason</th>
        <th className={thClass}>Awarded</th>
        <th className={thClass}></th>
      </Thead>
      <tbody>
        {awards.map((a) => (
          <tr key={a.id} className="border-b border-line last:border-0">
            <td className={tdClass}>{a.email}</td>
            <td className={tdClass}>{KIND_LABEL[a.kind]}</td>
            <td className={`${tdClass} numeric`}>+{a.points}</td>
            <td className={tdClass}>{a.reason}</td>
            <td className={tdClass}>{formatDateTime(a.awardedAt)}</td>
            <td className={tdClass}>
              <RevokeControl award={a} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function ManualAwardForm() {
  const [state, formAction, pending] = useActionState(createManualAwardAction, INITIAL_MANUAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Field label="Member email" required>
          {(id) => <input id={id} type="email" name="email" required className={inputClass} />}
        </Field>
        <Field label="Points" required>
          {(id) => <input id={id} type="number" name="points" required defaultValue={1} className={inputClass} />}
        </Field>
        <Field label="Reason" required>
          {(id) => <input id={id} name="reason" required className={inputClass} />}
        </Field>
      </div>
      {state.error ? <p className="text-sm font-medium text-alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Awarding…" : "Award"}
      </Button>
    </form>
  );
}

function ChampionCalculator() {
  const { show } = useToast();
  const [month, setMonth] = useState("");
  const [points, setPoints] = useState(5);
  const [preview, setPreview] = useState<ChampionPreviewResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function runPreview() {
    startTransition(async () => {
      const result = await previewChampionsAction(month);
      if (result.error) {
        show(result.error, "error");
        setPreview(null);
      } else {
        setPreview(result);
      }
    });
  }

  function calculate() {
    startTransition(async () => {
      const result = await calculateChampionsAction(month, points);
      if (result.error) show(result.error, "error");
      else if (result.unchanged) show("No change — already up to date for this month");
      else show(`Calculated: ${result.awarded.length} awarded, ${result.revoked.length} revoked`);
      setPreview(null);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Month" help="e.g. 2026-09 — must already be over.">
          {(id) => <input id={id} type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />}
        </Field>
        <Field label="Champion bonus (points)">
          {(id) => <input id={id} type="number" value={points} onChange={(e) => setPoints(Number(e.target.value))} className={inputClass} />}
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={runPreview} disabled={isPending || !month}>
          Preview
        </Button>
        <Button type="button" onClick={calculate} disabled={isPending || !month}>
          {isPending ? "Working…" : `Calculate champions for ${month || "…"}`}
        </Button>
      </div>

      {preview ? (
        <Card className="border-amber bg-amber/10">
          {preview.champions.length === 0 ? (
            <p className="text-sm text-ink">No one qualifies yet (or the month isn&apos;t over).</p>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">Would award +{points} to:</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-ink">
                {preview.champions.map((c) => (
                  <li key={c.email}>
                    {c.firstName} {c.lastName} ({c.email}) — {c.count} events
                    {preview.alreadyMaterialized.includes(c.email) ? <Badge tone="signal">Already awarded</Badge> : null}
                  </li>
                ))}
              </ul>
              {preview.alreadyMaterialized.some((e) => !preview.champions.some((c) => c.email === e)) ? (
                <p className="mt-2 text-xs text-muted">
                  Previously-awarded champions no longer in this list will be revoked on Calculate.
                </p>
              ) : null}
            </>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export default function AwardsManager({ awards }: { awards: PointAward[] }) {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Monthly Engagement Champion</h2>
        <Card>
          <ChampionCalculator />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Manual award</h2>
        <Card>
          <ManualAwardForm />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">All awards</h2>
        {awards.length === 0 ? (
          <p className="text-sm text-muted">No awards yet — game bonuses are granted from an event&apos;s Responses page.</p>
        ) : (
          <AwardsTable awards={awards} />
        )}
      </section>
    </div>
  );
}

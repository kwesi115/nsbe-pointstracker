"use client";

import { useState, useTransition } from "react";
import { awardGameBonusAction } from "@/app/(member)/admin/events/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import type { EventResponseRow } from "@/lib/repo";

/** Only members who registered for this event are selectable — matches the +1-per-member-per-event cap's intent (see lib/repo.ts awardGameBonus). */
export default function GameBonusAward({ eventId, responses }: { eventId: string; responses: EventResponseRow[] }) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [points, setPoints] = useState(1);
  const [isPending, startTransition] = useTransition();

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  }

  function submit() {
    if (selected.size === 0 || !reason.trim()) return;
    startTransition(async () => {
      const result = await awardGameBonusAction(eventId, [...selected], points, reason);
      if (result.error) {
        show(result.error, "error");
        return;
      }
      show(`Awarded ${result.awarded.length}${result.skipped.length ? `, ${result.skipped.length} already had it` : ""}`);
      setSelected(new Set());
      setReason("");
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Award game bonus
      </Button>
    );
  }

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium text-ink">Select members to award a game/competition bonus</p>
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-line p-2">
          {responses.map((r) => (
            <label key={r.email} className="flex min-h-9 items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={selected.has(r.email)} onChange={() => toggle(r.email)} className="h-4 w-4" />
              {r.firstName} {r.lastName} <span className="text-xs text-muted">{r.email}</span>
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Points
            <input type="number" value={points} onChange={(e) => setPoints(Number(e.target.value))} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Reason
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Trivia night winner" className={inputClass} />
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="button" onClick={submit} disabled={isPending || selected.size === 0 || !reason.trim()}>
            {isPending ? "Awarding…" : `Award to ${selected.size} member${selected.size === 1 ? "" : "s"}`}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

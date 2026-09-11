"use client";

import { useState } from "react";
import { awardGameBonusAction, type AwardGameBonusResult } from "@/app/(member)/admin/events/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useActionForm } from "@/components/ui/useActionForm";
import type { EventResponseRow } from "@/lib/repo";

const INITIAL_STATE: AwardGameBonusResult = { error: null, awarded: [], skipped: [] };

/** Only members who registered for this event are selectable — matches the +1-per-member-per-event cap's intent (see lib/repo.ts awardGameBonus). */
export default function GameBonusAward({ eventId, responses }: { eventId: string; responses: EventResponseRow[] }) {
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const award = useActionForm(awardGameBonusAction, INITIAL_STATE, {
    onSuccess: (state) => {
      show(`Awarded ${state.awarded.length}${state.skipped.length ? `, ${state.skipped.length} already had it` : ""}`);
      setSelected(new Set());
      setReason("");
      setOpen(false);
    },
    onError: (message) => show(message, "error"),
  });

  function toggle(email: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
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
      {/* A form submit, so the selection and the reason travel with the request
          and the button is disabled for the real duration of the write. */}
      <form action={award.formAction} onSubmit={award.onSubmit} className="flex flex-col gap-4">
        <p className="text-sm font-medium text-ink">Select members to award a game/competition bonus</p>
        <input type="hidden" name="eventId" value={eventId} />
        {[...selected].map((email) => (
          <input key={email} type="hidden" name="emails" value={email} />
        ))}
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
            <input type="number" name="points" defaultValue={1} min={0} required className={inputClass} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Reason
            <input
              name="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Trivia night winner"
              required
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={award.pending || selected.size === 0 || !reason.trim()}>
            {award.pending ? "Awarding…" : `Award to ${selected.size} member${selected.size === 1 ? "" : "s"}`}
          </Button>
          <Button type="button" variant="secondary" disabled={award.pending} onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

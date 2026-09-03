"use client";

import { useActionState, useState, useTransition } from "react";
import {
  finalizeGroupAction,
  toggleEventInGroupAction,
  updateTiersAction,
  type GroupActionState,
} from "@/app/(member)/admin/groups/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { textareaClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/format";
import type { GroupAttendanceRow } from "@/lib/repo";
import type { Event, EventGroup } from "@/lib/types";

const INITIAL_STATE: GroupActionState = { error: null };

function TierEditor({ group }: { group: EventGroup }) {
  const boundAction = updateTiersAction.bind(null, group.id);
  const [state, formAction, pending] = useActionState(boundAction, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <textarea
        name="bonusTiers"
        defaultValue={JSON.stringify(group.bonusTiers, null, 2)}
        rows={6}
        className={`${textareaClass} font-mono text-xs`}
      />
      {state.error ? <p className="text-sm font-medium text-alert">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save tiers"}
      </Button>
    </form>
  );
}

function EventAssignment({ group, allEvents }: { group: EventGroup; allEvents: Event[] }) {
  const { show } = useToast();
  const [isPending, startTransition] = useTransition();
  const groupEventIds = new Set(group.eventIds);

  function toggle(eventId: string, inGroup: boolean) {
    startTransition(async () => {
      const result = await toggleEventInGroupAction(eventId, inGroup ? null : group.id);
      if (result.error) show(result.error, "error");
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {allEvents.map((e) => {
        const inGroup = groupEventIds.has(e.eventId);
        const inOtherGroup = e.groupId !== null && e.groupId !== group.id;
        return (
          <label key={e.eventId} className="flex min-h-11 items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={inGroup}
              disabled={isPending || inOtherGroup}
              onChange={() => toggle(e.eventId, inGroup)}
              className="h-4 w-4"
            />
            {e.name} <span className="text-xs text-muted">· {formatDate(e.date)}</span>
            {inOtherGroup ? <span className="text-xs text-muted">(in another group)</span> : null}
          </label>
        );
      })}
    </div>
  );
}

export default function GroupDetail({
  group,
  allEvents,
  matrix,
}: {
  group: EventGroup;
  allEvents: Event[];
  matrix: GroupAttendanceRow[];
}) {
  const { show } = useToast();
  const [finalizing, setFinalizing] = useState(false);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={group.finalizedAt ? "signal" : "muted"}>{group.finalizedAt ? "Finalized" : "Not finalized"}</Badge>
        <span className="text-sm text-muted">
          {group.eventIds.length} of {group.expectedEventCount} events assigned
        </span>
        {!group.finalizedAt ? (
          <Button type="button" variant="danger" onClick={() => setFinalizing(true)}>
            Finalize
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={finalizing}
        title="Finalize this group?"
        description="Settles the completion bonus against whatever events currently exist in the group — use this when a planned event was canceled and never happened. This cannot be undone."
        confirmLabel="Finalize"
        tone="danger"
        pending={isPending}
        onCancel={() => setFinalizing(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await finalizeGroupAction(group.id);
            if (result.error) show(result.error, "error");
            else show("Group finalized");
            setFinalizing(false);
          })
        }
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Bonus tiers</h2>
        <Card>
          <TierEditor group={group} />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Events in this group</h2>
        <Card>
          <EventAssignment group={group} allEvents={allEvents} />
        </Card>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Member attendance</h2>
        <Table>
          <Thead>
            <th className={thClass}>Member</th>
            <th className={thClass}>Attended</th>
            <th className={thClass}>Current bonus</th>
          </Thead>
          <tbody>
            {matrix
              .filter((r) => r.attendedEventIds.length > 0)
              .sort((a, b) => b.attendedEventIds.length - a.attendedEventIds.length)
              .map((r) => (
                <tr key={r.email} className="border-b border-line last:border-0">
                  <td className={tdClass}>
                    {r.firstName} {r.lastName}
                  </td>
                  <td className={`${tdClass} numeric`}>
                    {r.attendedEventIds.length} of {group.expectedEventCount}
                  </td>
                  <td className={`${tdClass} numeric`}>{group.finalizedAt || r.bonus > 0 ? `+${r.bonus}` : "—"}</td>
                </tr>
              ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}

"use client";

import { Trash2 } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { addAttendanceAction, deleteAttendanceAction, type AddAttendanceState } from "@/app/(member)/admin/attendance/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { inputClass, selectClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/format";

export interface AttendanceRow {
  id: string;
  timestamp: string | null;
  eventName: string;
  name: string;
  email: string;
  points: number;
  source: string;
  note: string;
}

const INITIAL_STATE: AddAttendanceState = { error: null };

export default function AttendanceManager({
  rows,
  events,
  members,
}: {
  rows: AttendanceRow[];
  events: Array<{ eventId: string; name: string }>;
  members: Array<{ email: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(addAttendanceAction, INITIAL_STATE);
  const { show } = useToast();
  const [deleting, setDeleting] = useState<AttendanceRow | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Event
          <select name="eventId" required className={`${selectClass} w-56`}>
            <option value="">Select event…</option>
            {events.map((e) => (
              <option key={e.eventId} value={e.eventId}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Member
          <select name="email" required className={`${selectClass} w-56`}>
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m.email} value={m.email}>
                {m.name} ({m.email})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 min-w-48 flex-col gap-1 text-xs font-medium text-muted">
          Note (required)
          <input name="note" required placeholder="e.g. walked in, phone died" className={inputClass} />
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {state.error}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="No manual entries" description="Walk-ins and manual corrections show up here." />
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>Member</th>
            <th className={thClass}>Event</th>
            <th className={thClass}>Time</th>
            <th className={thClass}>Points</th>
            <th className={thClass}>Source</th>
            <th className={thClass}>Note</th>
            <th className={thClass}></th>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line last:border-0">
                <td className={tdClass}>
                  {r.name}
                  <div className="text-xs text-muted">{r.email}</div>
                </td>
                <td className={tdClass}>{r.eventName}</td>
                <td className={tdClass}>{formatDateTime(r.timestamp ? new Date(r.timestamp) : null)}</td>
                <td className={`${tdClass} numeric`}>{r.points}</td>
                <td className={tdClass}>
                  {r.source === "manual" ? <Badge tone="amber">Manual</Badge> : <Badge tone="muted">Member</Badge>}
                </td>
                <td className={tdClass}>{r.note}</td>
                <td className={tdClass}>
                  <button
                    type="button"
                    onClick={() => setDeleting(r)}
                    aria-label={`Delete attendance for ${r.name}`}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-alert hover:bg-alert/10"
                  >
                    <Trash2 size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this attendance record?"
        description={
          deleting ? (
            <>
              Removes {deleting.name}&apos;s {deleting.points}-point credit for {deleting.eventName}. Totals are
              always derived, so this takes effect immediately.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Delete"
        tone="danger"
        pending={isPending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          startTransition(async () => {
            const result = await deleteAttendanceAction(deleting.id);
            if (result.error) show(result.error, "error");
            else show("Deleted");
            setDeleting(null);
          });
        }}
      />
    </div>
  );
}

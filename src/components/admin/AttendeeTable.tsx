"use client";

import { useRef, useState, useTransition } from "react";
import {
  loadAttendeesAction,
  previewRemoveAction,
  removeRegistrationAction,
  updateRegistrationPointsAction,
} from "@/app/(member)/admin/attendance/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, memberDisplayName } from "@/lib/format";
import type { AttendeePage, AttendeeRow, RemoveRegistrationImpact } from "@/lib/repo";
import type { ActionResult, UpdatePointsState } from "@/app/(member)/admin/attendance/actions";

const DEBOUNCE_MS = 300;
const INITIAL_STATE: ActionResult = { error: null };
const INITIAL_POINTS_STATE: UpdatePointsState = { error: null, points: null };

/**
 * One event's attendees, paginated from the server.
 *
 * "Show more" fetches the next page through loadAttendeesAction rather than
 * revealing rows that were already sent — an event with 200 check-ins never
 * ships 200 rows to render 20. Searching re-queries the whole event for the
 * same reason: a name outside the loaded page still has to be findable.
 *
 * Manual rows carry a badge because at a glance an officer needs to know who
 * was added by hand and why — that is the difference between a check-in and
 * someone's judgement call.
 */
export default function AttendeeTable({
  eventId,
  initialPage,
  canWrite,
}: {
  eventId: string;
  initialPage: AttendeePage;
  /** attendance_write — see lib/access.ts. Read-only officers get the table with no row actions at all. */
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<AttendeeRow[]>(initialPage.rows);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [total, setTotal] = useState(initialPage.total);
  const [totalPoints, setTotalPoints] = useState(initialPage.totalPoints);
  const [q, setQ] = useState("");
  const [isPending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<{ row: AttendeeRow; impact: RemoveRegistrationImpact | null } | null>(null);
  const [editing, setEditing] = useState<AttendeeRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { show } = useToast();

  // Re-seed from the server whenever a fresh page arrives — a different event
  // selected, or router.refresh() after an add. Adjusting state during render
  // rather than in an effect: React re-runs this component immediately with
  // the new state and never commits the stale rows, so there is no flash of
  // the previous event's attendees and no cascading effect render.
  const [seed, setSeed] = useState(initialPage);
  if (seed !== initialPage) {
    setSeed(initialPage);
    setRows(initialPage.rows);
    setCursor(initialPage.nextCursor);
    setTotal(initialPage.total);
    setTotalPoints(initialPage.totalPoints);
    setQ("");
  }

  function applyPage(page: AttendeePage, append: boolean) {
    setRows((prev) => (append ? [...prev, ...page.rows] : page.rows));
    setCursor(page.nextCursor);
    setTotal(page.total);
    setTotalPoints(page.totalPoints);
  }

  function runSearch(value: string) {
    startTransition(async () => {
      const { page, error } = await loadAttendeesAction(eventId, null, value);
      if (error || !page) show(error ?? "Couldn't search attendees", "error");
      else applyPage(page, false);
    });
  }

  function onSearchChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  }

  function showMore() {
    startTransition(async () => {
      const { page, error } = await loadAttendeesAction(eventId, cursor, q);
      if (error || !page) show(error ?? "Couldn't load more", "error");
      else applyPage(page, true);
    });
  }

  function openRemove(row: AttendeeRow) {
    setRemoving({ row, impact: null });
    startTransition(async () => {
      const { impact } = await previewRemoveAction(row.registrationId);
      setRemoving((current) => (current && current.row.registrationId === row.registrationId ? { ...current, impact } : current));
    });
  }

  // Both confirmations below are dispatched by ConfirmDialog's form submit, so
  // the reason and the new point value are read from the submission rather than
  // from state a click handler closed over, the confirm button is disabled for
  // the real duration of the write, and a failure leaves the dialog open with
  // the message in it instead of closing over a toast.
  function removedLocally(row: AttendeeRow) {
    setRows((prev) => prev.filter((r) => r.registrationId !== row.registrationId));
    setTotal((t) => t - 1);
    setTotalPoints((p) => p - row.pointsAwarded);
    setRemoving(null);
    show("Registration removed");
  }

  function repointedLocally(row: AttendeeRow, next: number) {
    setRows((prev) => prev.map((r) => (r.registrationId === row.registrationId ? { ...r, pointsAwarded: next } : r)));
    setTotalPoints((p) => p - row.pointsAwarded + next);
    setEditing(null);
    show("Points updated");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="numeric text-sm text-muted">
          <span className="font-semibold text-ink">{total}</span> checked in ·{" "}
          <span className="font-semibold text-ink">{totalPoints}</span> points awarded
        </p>
        <label className="flex min-w-56 flex-col gap-1 text-xs font-medium text-muted">
          Search this event
          <input
            type="search"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Name, email, or student ID"
            className={inputClass}
          />
        </label>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={q ? "Nobody matches that search" : "Nobody checked in"}
          description={q ? "Try a different name or email." : "Add anyone who was there but missed check-in."}
        />
      ) : (
        <>
          <Table>
            <Thead>
              <th className={`${thClass} min-w-[170px]`}>Name</th>
              <th className={`${thClass} min-w-[210px]`}>Email</th>
              <th className={`${thClass} min-w-[130px]`}>Classification</th>
              <th className={`${thClass} min-w-[140px]`}>House</th>
              <th className={`${thClass} min-w-[170px]`}>Checked in</th>
              <th className={`${thClass} min-w-[80px]`}>Points</th>
              <th className={`${thClass} min-w-[220px]`}>Source</th>
              {canWrite ? <th className={`${thClass} min-w-[150px]`}>Actions</th> : null}
            </Thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.registrationId} className="border-b border-line last:border-0">
                  <td className={tdClass}>{memberDisplayName(r.firstName, r.lastName, r.email)}</td>
                  <td className={tdClass}>{r.email}</td>
                  <td className={tdClass}>{r.classification || "—"}</td>
                  <td className={tdClass}>{r.house || "—"}</td>
                  <td className={tdClass}>{r.checkedInAt ? formatDateTime(r.checkedInAt) : "—"}</td>
                  <td className={`${tdClass} numeric`}>{r.pointsAwarded}</td>
                  <td className={tdClass}>
                    {r.source === "manual" ? (
                      <div className="flex flex-col gap-1">
                        <Badge tone="amber">Added by hand</Badge>
                        {r.note ? <span className="text-xs text-muted">{r.note}</span> : null}
                      </div>
                    ) : (
                      <span className="text-muted">Checked in</span>
                    )}
                  </td>
                  {canWrite ? (
                    <td className={tdClass}>
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" disabled={isPending} onClick={() => setEditing(r)}>
                          Points
                        </Button>
                        <Button type="button" variant="ghost" disabled={isPending} onClick={() => openRemove(r)}>
                          Remove
                        </Button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>

          <div className="flex items-center gap-3">
            {/* Gone once every matching row is loaded. */}
            {cursor ? (
              <Button type="button" variant="secondary" onClick={showMore} disabled={isPending}>
                {isPending ? "Loading…" : "Show more"}
              </Button>
            ) : null}
            <p className="numeric text-xs text-muted">
              Showing {rows.length} of {total}
            </p>
          </div>
        </>
      )}

      {removing ? (
        <ConfirmDialog<ActionResult>
          open
          title="Remove this registration?"
          confirmLabel="Remove"
          tone="danger"
          action={removeRegistrationAction}
          initialState={INITIAL_STATE}
          payload={{ registrationId: removing.row.registrationId }}
          reason={{ label: "Reason", placeholder: "Logged twice, wrong event, didn't actually attend…", help: "Recorded in the admin log against your account." }}
          // The impact query is still in flight: confirming now would mean
          // confirming a number the officer hasn't seen.
          confirmDisabled={removing.impact === null}
          onCancel={() => setRemoving(null)}
          onSuccess={() => removedLocally(removing.row)}
          description={
          <div className="flex flex-col gap-3">
            <p className="text-sm text-ink">
              {memberDisplayName(removing.row.firstName, removing.row.lastName, removing.row.email)} will be removed from
              this event.
            </p>
            {/* The impact, spelled out: removal lowers a leaderboard total. */}
            {removing.impact ? (
              <div className="flex flex-col gap-1 rounded-lg bg-surface-sunken px-3 py-2 text-sm">
                <p className="text-ink">
                  They lose <span className="numeric font-semibold">{removing.impact.pointsLost}</span> point
                  {removing.impact.pointsLost === 1 ? "" : "s"} from their season total.
                </p>
                {removing.impact.groupBonusChange ? (
                  <p className="text-ink">
                    Their {removing.impact.groupBonusChange.groupName} bonus changes from{" "}
                    <span className="numeric font-semibold">{removing.impact.groupBonusChange.from}</span> to{" "}
                    <span className="numeric font-semibold">{removing.impact.groupBonusChange.to}</span>.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">Working out the impact…</p>
            )}
          </div>
          }
        />
      ) : null}

      {editing ? (
        <ConfirmDialog<UpdatePointsState>
          open
          title="Correct the points awarded"
          confirmLabel="Save"
          action={updateRegistrationPointsAction}
          initialState={INITIAL_POINTS_STATE}
          payload={{ registrationId: editing.registrationId }}
          reason={{ label: "Reason", placeholder: "Category value was wrong at check-in…", help: "Recorded in the admin log with the before and after values." }}
          onCancel={() => setEditing(null)}
          // The action reports the value it wrote, so the row updates to what
          // the server stored rather than to what the input happened to hold.
          onSuccess={(state) => repointedLocally(editing, state.points ?? editing.pointsAwarded)}
          description={
            <p className="text-sm text-ink">
              {memberDisplayName(editing.firstName, editing.lastName, editing.email)} currently has{" "}
              <span className="numeric font-semibold">{editing.pointsAwarded}</span>.
            </p>
          }
        >
          {/* An extra named input inside the dialog's form: uncontrolled, so
              the value submitted is whatever is on screen, and `required`
              makes the browser refuse a blank before React dispatches. */}
          <Field label="Points" required>
            {(id) => (
              <input
                id={id}
                name="points"
                type="number"
                min={0}
                required
                defaultValue={editing.pointsAwarded}
                className={inputClass}
              />
            )}
          </Field>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import {
  emptyTrashAction,
  previewEmptyTrashAction,
  purgeEventAction,
  purgeMemberAction,
  restoreEventAction,
  restoreMemberAction,
  runCleanupAction,
  type TrashActionState,
} from "@/app/(member)/admin/trash/actions";
import ActionButton from "@/components/ui/ActionButton";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import Field, { inputClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatDate, formatDateTime, pluralize } from "@/lib/format";
import type { EmptyTrashPreview, TrashedEventRow, TrashedMemberRow, TrashListing } from "@/lib/repo";

const INITIAL_STATE: TrashActionState = { error: null };
const DAY_MS = 24 * 60 * 60 * 1000;

type Tab = "members" | "events";

/** "Permanently deletes in 12 days (Oct 1, 2026)", or what happens to an item already past its date. */
function ExpiryCell({ at, now, paused }: { at: Date; now: Date; paused: boolean }) {
  const days = Math.ceil((at.getTime() - now.getTime()) / DAY_MS);
  if (days <= 0) {
    return (
      <span className="text-xs font-medium text-alert">
        Past its date ({formatDate(at)}) — {paused ? "retention paused" : "deleted at the next cleanup"}
      </span>
    );
  }
  return (
    <span className="text-sm text-foreground">
      Permanently deletes in <span className="numeric font-semibold">{pluralize(days, "day")}</span>
      <span className="text-muted"> ({formatDate(at)})</span>
    </span>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * /admin/trash. Two tabs, each sorted soonest-to-delete. Restore puts an item
 * back everywhere exactly as it was; Delete now and Empty trash are permanent,
 * require typing the email / event name / DELETE (re-checked on the server),
 * and are refused outright while backup storage is unconfigured — the same
 * condition that pauses scheduled expiry.
 */
export default function TrashBin({ trash, now }: { trash: TrashListing; now: Date }) {
  const { show } = useToast();
  const [tab, setTab] = useState<Tab>(trash.members.length === 0 && trash.events.length > 0 ? "events" : "members");
  const [restoring, setRestoring] = useState<{ kind: Tab; id: string; label: string } | null>(null);
  const [purging, setPurging] = useState<{ kind: Tab; id: string; label: string; confirmWith: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [emptying, setEmptying] = useState(false);
  const [emptyPreview, setEmptyPreview] = useState<EmptyTrashPreview | null>(null);
  const [emptyTyped, setEmptyTyped] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const paused = !trash.backup.configured;
  const total = trash.members.length + trash.events.length;

  function openEmpty() {
    setEmptying(true);
    setEmptyPreview(null);
    setEmptyTyped("");
    startTransition(async () => {
      const result = await previewEmptyTrashAction();
      if (result.error) show(result.error, "error");
      setEmptyPreview(result.preview);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {paused ? (
        <div role="status" className="flex flex-col gap-1 rounded-xl border border-alert bg-alert/10 px-4 py-3 text-sm text-foreground">
          <p className="font-semibold">Retention paused — backup storage not configured</p>
          <p className="text-xs text-muted">
            Nothing is permanently deleted without a backup behind it, so items past their date stay here, and Delete now
            and Empty trash are blocked, until backup storage is set up. ({trash.backup.configured ? "" : trash.backup.reason})
          </p>
        </div>
      ) : null}

      {notice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-xl border border-torch-border bg-torch-subtle px-4 py-3 text-sm text-foreground">
          <p>{notice}</p>
          <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline underline-offset-2">
            Dismiss
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Trash" className="flex gap-1 rounded-lg border border-border bg-surface p-1">
          {(
            [
              ["members", `Accounts (${trash.members.length})`],
              ["events", `Events (${trash.events.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`min-h-11 rounded-md px-4 text-sm font-semibold ${tab === key ? "bg-surface-raised text-foreground" : "text-muted"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ActionButton<TrashActionState>
            action={runCleanupAction}
            initialState={INITIAL_STATE}
            label="Run cleanup now"
            variant="secondary"
            onSuccess={(state) => show(state.summary ?? "Cleanup finished")}
            onError={(message) => show(message, "error")}
          />
          <Button type="button" variant="danger" onClick={openEmpty} disabled={total === 0 || paused}>
            Empty trash
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted">
        Expired items are removed when an admin opens /admin or this page (at most once an hour), or by the cleanup
        route. Last cleanup: {trash.lastSweepAt ? formatDateTime(trash.lastSweepAt) : "never"}.
      </p>

      {tab === "members" ? (
        trash.members.length === 0 ? (
          <EmptyState title="No accounts in the trash" description="Move a member to the trash from their page in the Member Directory." />
        ) : (
          <MembersTab
            rows={trash.members}
            now={now}
            paused={paused}
            onRestore={(r) => setRestoring({ kind: "members", id: r.id, label: r.name })}
            onPurge={(r) => {
              setTyped("");
              setPurging({ kind: "members", id: r.id, label: r.name, confirmWith: r.email });
            }}
          />
        )
      ) : trash.events.length === 0 ? (
        <EmptyState title="No events in the trash" description="Delete an event from the Events board to move it here." />
      ) : (
        <EventsTab
          rows={trash.events}
          now={now}
          paused={paused}
          onRestore={(r) => setRestoring({ kind: "events", id: r.id, label: r.name })}
          onPurge={(r) => {
            setTyped("");
            setPurging({ kind: "events", id: r.id, label: r.name, confirmWith: r.name });
          }}
        />
      )}

      {restoring ? (
        <ConfirmDialog<TrashActionState>
          open
          title={`Restore ${restoring.label}?`}
          description={
            restoring.kind === "members"
              ? "They come back everywhere — roster, leaderboards, exports, sign-in — with every registration, award and adjustment counting again exactly as before. Permission grants revoked when they were trashed stay revoked."
              : "It comes back everywhere, and every count it contributed to — attendance, points, NSBE Week tiers, Monthly Champion counts — goes back to exactly what it was."
          }
          confirmLabel="Restore"
          action={restoring.kind === "members" ? restoreMemberAction : restoreEventAction}
          initialState={INITIAL_STATE}
          payload={{ id: restoring.id }}
          onCancel={() => setRestoring(null)}
          onSuccess={(state) => {
            show(`Restored ${restoring.label}`);
            if (state.warning) setNotice(state.warning);
            setRestoring(null);
          }}
        />
      ) : null}

      {purging ? (
        <ConfirmDialog<TrashActionState>
          open
          title={`Permanently delete ${purging.label}?`}
          description={
            purging.kind === "members"
              ? "This can't be undone. Their registrations, answers, awards and adjustments, permission grants, and uploaded files — including the stored files themselves — are deleted. A backup snapshot is taken first, and the admin log keeps a record of what was removed."
              : "This can't be undone. Its registrations, answers, game bonuses and form are deleted; adjustments that only link to it keep their points. A backup snapshot is taken first, and the admin log keeps a record of what was removed."
          }
          confirmLabel="Delete permanently"
          tone="danger"
          action={purging.kind === "members" ? purgeMemberAction : purgeEventAction}
          initialState={INITIAL_STATE}
          payload={{ id: purging.id }}
          confirmDisabled={
            paused ||
            (purging.kind === "members"
              ? typed.trim().toLowerCase() !== purging.confirmWith.toLowerCase()
              : typed.trim() !== purging.confirmWith.trim())
          }
          onCancel={() => setPurging(null)}
          onSuccess={(state) => {
            show(state.summary ?? "Permanently deleted");
            setPurging(null);
          }}
        >
          <Field
            label={purging.kind === "members" ? "Type their email to confirm" : "Type the event name to confirm"}
            required
            help={<span className="font-mono">{purging.confirmWith}</span>}
          >
            {(id, describedBy) => (
              <input
                id={id}
                name="confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                aria-describedby={describedBy}
                className={inputClass}
              />
            )}
          </Field>
        </ConfirmDialog>
      ) : null}

      <ConfirmDialog<TrashActionState>
        open={emptying}
        title="Empty the trash?"
        confirmLabel="Delete everything permanently"
        tone="danger"
        action={emptyTrashAction}
        initialState={INITIAL_STATE}
        confirmDisabled={paused || !emptyPreview || emptyTyped !== "DELETE"}
        onCancel={() => setEmptying(false)}
        onSuccess={(state) => {
          show(state.summary ?? "Trash emptied");
          setEmptying(false);
        }}
        description={
          !emptyPreview ? (
            <p>Counting what would be deleted…</p>
          ) : (
            <div className="flex flex-col gap-2 text-foreground">
              <p>This can&apos;t be undone. Everything below is deleted permanently, after a backup snapshot of each item:</p>
              <ul className="list-disc pl-5">
                <li>{pluralize(emptyPreview.members, "account")}{emptyPreview.memberLabels.length > 0 ? `: ${emptyPreview.memberLabels.join(", ")}` : ""}</li>
                <li>{pluralize(emptyPreview.events, "event")}{emptyPreview.eventLabels.length > 0 ? `: ${emptyPreview.eventLabels.join(", ")}` : ""}</li>
                <li>{pluralize(emptyPreview.registrations, "registration")} and {pluralize(emptyPreview.answers, "form answer")}</li>
                <li>
                  {pluralize(emptyPreview.awards, "point award")}
                  {emptyPreview.adjustments > 0 ? `, ${pluralize(emptyPreview.adjustments, "adjustment")} among them` : ""}
                </li>
                <li>{pluralize(emptyPreview.grants, "permission grant")}</li>
                <li>
                  {pluralize(emptyPreview.files, "uploaded file")} ({formatBytes(emptyPreview.fileBytes)}), stored files included
                </li>
              </ul>
            </div>
          )
        }
      >
        <Field label="Type DELETE to confirm" required>
          {(id, describedBy) => (
            <input
              id={id}
              name="confirm"
              value={emptyTyped}
              onChange={(e) => setEmptyTyped(e.target.value)}
              autoComplete="off"
              aria-describedby={describedBy}
              className={inputClass}
            />
          )}
        </Field>
      </ConfirmDialog>
    </div>
  );
}

function RowActions({ onRestore, onPurge, paused }: { onRestore: () => void; onPurge: () => void; paused: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" onClick={onRestore}>
        Restore
      </Button>
      <Button type="button" variant="ghost" onClick={onPurge} disabled={paused}>
        Delete now
      </Button>
    </div>
  );
}

function DeletedBy({ name, at, reason }: { name: string; at: Date; reason: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm text-foreground">
        {name || "Unknown"} · {formatDateTime(at)}
      </span>
      {reason ? <span className="text-xs text-muted">{reason}</span> : null}
    </div>
  );
}

function MembersTab({
  rows,
  now,
  paused,
  onRestore,
  onPurge,
}: {
  rows: TrashedMemberRow[];
  now: Date;
  paused: boolean;
  onRestore: (r: TrashedMemberRow) => void;
  onPurge: (r: TrashedMemberRow) => void;
}) {
  return (
    <Table>
      <Thead>
        <th className={thClass}>Account</th>
        <th className={thClass}>Deleted</th>
        <th className={thClass}>Expires</th>
        <th className={thClass}></th>
      </Thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border align-top last:border-0">
            <td className={tdClass}>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">
                  {r.name} <Badge tone="muted">{r.role}</Badge>
                </span>
                <span className="text-xs text-muted">{r.email}</span>
                <span className="numeric text-xs text-muted">
                  {pluralize(r.registrations, "registration")}
                  {r.files > 0 ? ` · ${pluralize(r.files, "file")}` : ""}
                </span>
              </div>
            </td>
            <td className={tdClass}>
              <DeletedBy name={r.deletedByName} at={r.deletedAt} reason={r.deleteReason} />
            </td>
            <td className={tdClass}>
              <ExpiryCell at={r.permanentDeleteAt} now={now} paused={paused} />
            </td>
            <td className={tdClass}>
              <RowActions onRestore={() => onRestore(r)} onPurge={() => onPurge(r)} paused={paused} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function EventsTab({
  rows,
  now,
  paused,
  onRestore,
  onPurge,
}: {
  rows: TrashedEventRow[];
  now: Date;
  paused: boolean;
  onRestore: (r: TrashedEventRow) => void;
  onPurge: (r: TrashedEventRow) => void;
}) {
  return (
    <Table>
      <Thead>
        <th className={thClass}>Event</th>
        <th className={thClass}>Deleted</th>
        <th className={thClass}>Expires</th>
        <th className={thClass}></th>
      </Thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-border align-top last:border-0">
            <td className={tdClass}>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-foreground">{r.name}</span>
                <span className="text-xs text-muted">
                  {r.categoryName} · {formatDate(r.date)}
                </span>
                <span className="numeric text-xs text-muted">{pluralize(r.registrations, "registration")}</span>
              </div>
            </td>
            <td className={tdClass}>
              <DeletedBy name={r.deletedByName} at={r.deletedAt} reason={r.deleteReason} />
            </td>
            <td className={tdClass}>
              <ExpiryCell at={r.permanentDeleteAt} now={now} paused={paused} />
            </td>
            <td className={tdClass}>
              <RowActions onRestore={() => onRestore(r)} onPurge={() => onPurge(r)} paused={paused} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

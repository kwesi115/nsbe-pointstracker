"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  addAttendeesAction,
  previewAddAttendeesAction,
  searchAddableMembersAction,
  type AddAttendeesState,
} from "@/app/(member)/admin/attendance/actions";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Field, { inputClass, textareaClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { useActionForm } from "@/components/ui/useActionForm";
import { memberDisplayName } from "@/lib/format";
import type { AddableMember, ManualAddPreview } from "@/lib/repo";

const DEBOUNCE_MS = 250;
const INITIAL_STATE: AddAttendeesState = { error: null, result: null };

/**
 * Adding people who were there but missed check-in — the primary reason the
 * attendance directory exists.
 *
 * Three things this deliberately does NOT skip:
 *   - the note is required, with no default. "Phone died", "arrived late",
 *     "checked in on paper" — a manual add is someone's judgement call and the
 *     roster should say whose and why.
 *   - a preview step, because the officer is awarding points to a closed
 *     event and cannot otherwise see what that does (an E-Board member earns
 *     0 on the member track; an NSBE Week event can move a bonus tier; an
 *     open month's Engagement Champion can flip).
 *   - the picker only ever offers people who aren't already registered, so
 *     the unique constraint is a backstop rather than the error path.
 *
 * The final Add is a form submit, like every other mutation in the admin area:
 * the selection and the note travel in the submission, `pending` is React's own
 * so the button is disabled for the real duration of the write, and a failure
 * leaves the dialog open with the error in it. Searching and previewing stay on
 * a transition — they are reads, and repeating a read costs nothing.
 */
export default function AddAttendeeDialog({ eventId, eventName }: { eventId: string; eventName: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState<AddableMember[]>([]);
  const [selected, setSelected] = useState<Map<string, AddableMember>>(new Map());
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<ManualAddPreview | null>(null);
  const [isPending, startTransition] = useTransition();
  const chosen = [...selected.values()];
  const add = useActionForm(addAttendeesAction, INITIAL_STATE, {
    onSuccess: (state) => {
      const result = state.result;
      if (!result) return;
      const parts = [`${result.added.length} added`];
      if (result.alreadyRegistered.length > 0) parts.push(`${result.alreadyRegistered.length} already added`);
      if (result.notFound.length > 0) parts.push(`${result.notFound.length} not found`);
      show(parts.join(" · "), result.added.length > 0 ? "success" : "error");
      setOpen(false);
      reset();
      // Re-renders the server tree so the event list's counts and the
      // attendee table both reflect the rows just written.
      router.refresh();
    },
  });
  const dialogRef = useRef<HTMLDialogElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { show } = useToast();
  const router = useRouter();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function reset() {
    setQ("");
    setCandidates([]);
    setSelected(new Map());
    setNote("");
    setPreview(null);
  }

  function search(value: string) {
    startTransition(async () => {
      const { members, error } = await searchAddableMembersAction(eventId, value);
      if (error) show(error, "error");
      else setCandidates(members);
    });
  }

  function onSearchChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), DEBOUNCE_MS);
  }

  function toggle(member: AddableMember) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(member.email)) next.delete(member.email);
      else next.set(member.email, member);
      return next;
    });
    // Any change to the selection invalidates the numbers already shown.
    setPreview(null);
  }

  function runPreview() {
    startTransition(async () => {
      const { preview: p, error } = await previewAddAttendeesAction(eventId, [...selected.keys()]);
      if (error || !p) show(error ?? "Couldn't work out the impact", "error");
      else setPreview(p);
    });
  }

  return (
    <>
      <Button
        type="button"
        onClick={() => {
          setOpen(true);
          search("");
        }}
      >
        Add attendee
      </Button>

      <dialog
        ref={dialogRef}
        // Inert while the write is in flight, so the result can't land in a
        // dialog the officer has already dismissed.
        onCancel={(e) => {
          if (add.pending) e.preventDefault();
          else setOpen(false);
        }}
        onClose={() => {
          if (!add.pending) setOpen(false);
        }}
        className="inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-line bg-surface p-0 backdrop:bg-ink/50 sm:inset-0 sm:m-auto sm:max-h-[85dvh] sm:w-full sm:max-w-lg sm:rounded-xl"
      >
        <form action={add.formAction} onSubmit={add.onSubmit} className="pb-safe-bottom flex flex-col gap-4 p-5">
          <div>
            <h2 className="font-display text-lg font-bold text-ink">Add attendees</h2>
            <p className="text-sm text-muted">{eventName}</p>
          </div>

          <input type="hidden" name="eventId" value={eventId} />
          {chosen.map((m) => (
            <input key={m.email} type="hidden" name="emails" value={m.email} />
          ))}

          <Field label="Find members" help="Anyone already registered for this event is left out.">
            {(id) => (
              <input
                id={id}
                type="search"
                value={q}
                onChange={(e) => onSearchChange(e.target.value)}
                // The whole dialog is one form, so Enter in a text field is an
                // implicit submit — which here would skip the Review step and
                // add the selection straight away. Searching is not
                // confirming.
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                placeholder="Name, email, or student ID"
                className={inputClass}
              />
            )}
          </Field>

          <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
            {candidates.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted">
                {isPending ? "Searching…" : "Nobody left to add matching that search."}
              </p>
            ) : (
              <ul className="flex flex-col">
                {candidates.map((m) => (
                  <li key={m.email} className="border-b border-line last:border-0">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-surface-sunken">
                      <input
                        type="checkbox"
                        checked={selected.has(m.email)}
                        onChange={() => toggle(m)}
                        className="h-4 w-4"
                      />
                      <span className="flex flex-col">
                        <span className="text-ink">{memberDisplayName(m.firstName, m.lastName, m.email)}</span>
                        <span className="text-xs text-muted">
                          {m.email}
                          {m.studentId ? ` · ${m.studentId}` : ""}
                        </span>
                      </span>
                      {m.role !== "general" ? <Badge tone="muted">{m.role === "eboard" ? "E-Board" : m.role}</Badge> : null}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {chosen.length > 0 ? (
            <p className="text-sm text-ink">
              <span className="numeric font-semibold">{chosen.length}</span> selected
            </p>
          ) : null}

          <Field label="Why are they being added?" required help="Required. Recorded in the admin log against your account, per member.">
            {(id) => (
              <textarea
                id={id}
                name="reason"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Phone died, arrived late, checked in on paper…"
                required
                className={textareaClass}
              />
            )}
          </Field>

          {/* Everything the officer can't see from the picker. */}
          {preview ? (
            <div className="flex flex-col gap-2 rounded-lg bg-surface-sunken px-3 py-3 text-sm">
              <p className="font-semibold text-ink">
                {preview.totalPoints} point{preview.totalPoints === 1 ? "" : "s"} will be awarded
                {preview.eventClosed ? " to a closed event" : ""}.
              </p>
              <ul className="flex flex-col gap-1">
                {preview.members.map((m) => (
                  <li key={m.email} className="flex flex-wrap items-baseline gap-2">
                    <span className="text-ink">{m.name}</span>
                    <span className="numeric font-semibold text-ink">{m.points}</span>
                    {m.zeroByRole ? (
                      <span className="text-xs text-muted">(0 on the member track — earns on the E-Board track)</span>
                    ) : null}
                    {m.groupBonusChange ? (
                      <span className="text-xs text-ink">
                        · {m.groupBonusChange.groupName} bonus {m.groupBonusChange.from} → {m.groupBonusChange.to}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {preview.monthlyChampionStillOpen && preview.monthlyChampionMonth ? (
                <p className="text-ink">
                  {preview.monthlyChampionMonth} is still open — this counts toward the Monthly Engagement Champion and
                  can change who wins it.
                </p>
              ) : null}
            </div>
          ) : null}

          {add.error ? (
            <p role="alert" className="text-sm font-medium text-alert">
              {add.error}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={add.pending}
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Cancel
            </Button>
            {preview ? (
              <Button type="submit" disabled={add.pending || !note.trim() || chosen.length === 0}>
                {add.pending ? "Adding…" : `Add ${chosen.length}`}
              </Button>
            ) : (
              <Button type="button" onClick={runPreview} disabled={isPending || chosen.length === 0}>
                {isPending ? "Working…" : "Review"}
              </Button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}

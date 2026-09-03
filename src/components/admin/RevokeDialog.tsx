"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { textareaClass } from "@/components/ui/Field";

/**
 * Same native <dialog> pattern as ui/ConfirmDialog.tsx, extended with a
 * required note field — an admin revoking a self-reported claim must say why
 * (see lib/repo.ts revokeDues/revokeNational). The confirm button stays
 * disabled until the note is non-empty.
 */
export default function RevokeDialog({
  open,
  title,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  pending?: boolean;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Cleared on close (not on open) — avoids setState in the open-sync
  // effect above, and the field is empty again by the time it's next shown.
  function close() {
    setNote("");
    onCancel();
  }

  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClose={close}
      className="m-auto w-full max-w-sm rounded-xl border border-line bg-surface p-0 backdrop:bg-ink/50"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        <p className="text-sm text-muted">
          This removes them from the leaderboard immediately and re-arms the question at their next check-in. Say why.
        </p>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Payment record doesn't show this member"
          rows={3}
          autoFocus
          className={textareaClass}
        />
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => {
              onConfirm(note.trim());
              setNote("");
            }}
            disabled={pending || note.trim() === ""}
          >
            {pending ? "Working…" : "Revoke"}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

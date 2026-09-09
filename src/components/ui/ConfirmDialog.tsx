"use client";

import { useEffect, useRef } from "react";
import Button, { type ButtonVariant } from "./Button";

/**
 * Native <dialog> gives us a real accessible modal for free: Escape closes
 * it, focus is trapped inside, and the ::backdrop is click-to-dismiss —
 * without hand-rolling a focus trap.
 */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ButtonVariant;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={onCancel}
      onClose={onCancel}
      // Tailwind's preflight zeroes every element's margin, which quietly
      // breaks the browser's own `dialog:modal { margin: auto }` centering
      // rule — the sm: breakpoint below restores it explicitly rather than
      // relying on the UA default. Below sm: this is a full-screen bottom
      // sheet instead of a small centered card — easier to hit with a thumb
      // and immune to the "tiny dialog on a huge dark backdrop" look a
      // desktop-sized modal gets on a phone.
      className="inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-line bg-surface p-0 backdrop:bg-ink/50 sm:inset-0 sm:m-auto sm:max-h-none sm:w-full sm:max-w-sm sm:rounded-xl"
    >
      <div className="pb-safe-bottom flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        <div className="text-sm text-muted">{description}</div>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button type="button" variant={tone} onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

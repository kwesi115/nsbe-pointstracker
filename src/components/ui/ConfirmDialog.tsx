"use client";

import { useEffect, useId, useRef, useState } from "react";
import Button, { type ButtonVariant } from "./Button";
import Field, { textareaClass } from "./Field";
import { newRequestToken, useActionForm, type ActionFormState } from "./useActionForm";

/**
 * The shared confirm-then-mutate dialog. Every destructive or point-moving
 * admin action goes through this one component.
 *
 * WHY IT OWNS THE DISPATCH
 * ------------------------
 * The action is dispatched by SUBMITTING A FORM — `<form action={formAction}>`
 * with the payload in hidden inputs — never by calling a dispatcher from an
 * onClick handler. That is not a style preference: a useActionState dispatcher
 * called from onClick runs outside any transition, so `isPending` never flips,
 * the confirm button is never disabled, and the action can be fired twice (see
 * useActionForm.ts). Wrapping that call in startTransition would also silence
 * the warning, but would leave two patterns in the codebase. This is the one.
 *
 * WHAT IT GUARANTEES
 * ------------------
 *   - Confirm is `type="submit"`, so React owns the transition and `pending`
 *     is real; the button is disabled while it is true.
 *   - A submit that arrives anyway (two clicks in the same tick, Enter held
 *     down) is dropped by useActionForm's lock. That is a client-side
 *     affordance only — see lib/repo.ts claimRequestToken for the server-side
 *     guarantee on the actions that generate a credential.
 *   - The dialog stays OPEN until the action resolves. On failure the error
 *     renders inline, in the dialog the admin is still looking at; only a
 *     success calls onSuccess (where the caller closes it). An error can never
 *     land in a dialog that has already closed.
 *   - Escape, the backdrop and Cancel are inert while pending, for the same
 *     reason.
 *   - `reason` renders a required note field inside the form and keeps confirm
 *     disabled until it has content.
 *
 * MOBILE
 * ------
 * Below sm: a full-screen bottom sheet rather than a centered card; every
 * control is a Button (min-h-11 = 44px); `pb-safe-bottom` keeps the actions
 * clear of the home indicator. Native <dialog> + showModal() renders in the
 * browser's top layer, so it sits above MemberBottomNav whatever z-index that
 * carries, and brings Escape-to-close plus a real focus trap with nothing
 * hand-rolled.
 */

export type ConfirmActionState = ActionFormState;

export interface ConfirmReasonField {
  label: string;
  /** Form field name the action reads. Defaults to "reason". */
  name?: string;
  placeholder?: string;
  help?: React.ReactNode;
}

export default function ConfirmDialog<S extends ConfirmActionState>(props: ConfirmDialogProps<S>) {
  // Each opening remounts the form below, which is what makes "no stale state"
  // structural rather than a pile of clearing effects: a fresh useActionState
  // (so last attempt's error is gone), a fresh note field, and a fresh request
  // token. Adjusting state during render on a prop transition is React's own
  // pattern for this — see AttendeeTable's page re-seed for the other instance
  // of it in this codebase.
  const [openingId, setOpeningId] = useState(0);
  const [wasOpen, setWasOpen] = useState(props.open);
  if (props.open !== wasOpen) {
    setWasOpen(props.open);
    if (props.open) setOpeningId((n) => n + 1);
  }

  return <ConfirmDialogInstance key={openingId} {...props} />;
}

interface ConfirmDialogProps<S extends ConfirmActionState> {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ButtonVariant;
  /** A `(prevState, formData)` server action — the only shape React can own a transition for. */
  action: (prevState: S, formData: FormData) => Promise<S>;
  initialState: S;
  /** Rendered as hidden inputs, so the payload travels with the submission instead of being closed over by a click handler. */
  payload?: Record<string, string | number | boolean | null | undefined>;
  /** Ask for a note the action requires. Confirm stays disabled until it is non-empty. */
  reason?: ConfirmReasonField;
  /** Extra guard on top of pending/reason — e.g. an impact preview that hasn't loaded yet. */
  confirmDisabled?: boolean;
  /** Extra inputs rendered inside the form. Give them `name`s; their values are submitted with the action. */
  children?: React.ReactNode;
  onCancel: () => void;
  /** Called only after the action resolves WITHOUT an error. Close the dialog here. */
  onSuccess: (state: S) => void;
}

function ConfirmDialogInstance<S extends ConfirmActionState>({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "primary",
  action,
  initialState,
  payload,
  reason,
  confirmDisabled = false,
  children,
  onCancel,
  onSuccess,
}: ConfirmDialogProps<S>) {
  const { formAction, pending, error, onSubmit } = useActionForm(action, initialState, { onSuccess });
  const ref = useRef<HTMLDialogElement>(null);
  const [reasonText, setReasonText] = useState("");
  // Minted once per mount, i.e. once per opening. Rendered only while open, so
  // a server-rendered (closed) dialog emits no token and hydration has nothing
  // to mismatch on.
  const [requestToken] = useState(newRequestToken);
  const errorId = `${useId()}-error`;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Note there is no `onClose` handler. A native dialog fires `close` both when
  // the user dismisses it AND when the effect above closes it because the
  // caller set open={false} — wiring that to onCancel told the caller "the user
  // cancelled" immediately after telling it "the action succeeded". Escape
  // fires `cancel`, which is the only user-initiated close path (a native
  // dialog has no light dismiss without closedby="any"), so that is the only
  // one handled.

  const blocked = pending || confirmDisabled || (reason ? reasonText.trim() === "" : false);

  return (
    <dialog
      ref={ref}
      // Escape fires `cancel`; preventing it while pending is what stops an
      // admin dismissing the dialog into the void mid-request.
      onCancel={(e) => {
        if (pending) {
          e.preventDefault();
          return;
        }
        onCancel();
      }}
      // Tailwind's preflight zeroes every element's margin, which quietly
      // breaks the browser's own `dialog:modal { margin: auto }` centering
      // rule — the sm: breakpoint below restores it explicitly rather than
      // relying on the UA default. Below sm: this is a full-screen bottom
      // sheet instead of a small centered card — easier to hit with a thumb
      // and immune to the "tiny dialog on a huge dark backdrop" look a
      // desktop-sized modal gets on a phone.
      className="inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-2xl border border-line bg-surface p-0 backdrop:bg-ink/50 sm:inset-0 sm:m-auto sm:max-h-[85dvh] sm:w-full sm:max-w-sm sm:rounded-xl"
    >
      <form action={formAction} onSubmit={onSubmit} className="pb-safe-bottom flex flex-col gap-3 p-5">
        <h2 className="font-display text-lg font-bold text-ink">{title}</h2>
        {description ? <div className="text-sm text-muted">{description}</div> : null}

        {open ? <input type="hidden" name="requestToken" value={requestToken} /> : null}

        {Object.entries(payload ?? {}).map(([name, value]) =>
          value === null || value === undefined ? null : (
            <input key={name} type="hidden" name={name} value={String(value)} />
          ),
        )}

        {children}

        {reason ? (
          <Field label={reason.label} required help={reason.help}>
            {(id, describedBy) => (
              <textarea
                id={id}
                name={reason.name ?? "reason"}
                value={reasonText}
                onChange={(e) => setReasonText(e.target.value)}
                placeholder={reason.placeholder}
                aria-describedby={describedBy}
                required
                className={textareaClass}
              />
            )}
          </Field>
        ) : null}

        {error ? (
          <p id={errorId} role="alert" className="text-sm font-medium text-alert">
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button type="submit" variant={tone} disabled={blocked} aria-describedby={error ? errorId : undefined}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

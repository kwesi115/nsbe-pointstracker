"use client";

import Button, { type ButtonVariant } from "./Button";
import { useActionForm, type ActionFormState } from "./useActionForm";

/**
 * A single-button mutation, dispatched the same way ConfirmDialog dispatches:
 * a real form submit, so React owns the transition and `pending` is genuine.
 *
 * This exists so the buttons that don't warrant a confirmation step (verify a
 * claim, grant a permission, extend an open event by ten minutes) still can't
 * double-fire. The pattern they replaced — `onClick={() =>
 * startTransition(async () => { await someAction(...) })}` with
 * `disabled={isPending}` — reports pending correctly but leaves a real gap:
 * `isPending` is only true after React re-renders, so two clicks inside one
 * frame both reach the action. "+10 min" twice is +20 minutes.
 *
 * Errors go to the caller's onError (a toast, usually) rather than inline:
 * these buttons live in table rows with nowhere to put a paragraph.
 */
export default function ActionButton<S extends ActionFormState>({
  action,
  initialState,
  payload,
  label,
  pendingLabel = "Working…",
  variant = "primary",
  className,
  formClassName,
  disabled = false,
  ariaLabel,
  children,
  onSuccess,
  onError,
}: {
  action: (prevState: S, formData: FormData) => Promise<S>;
  initialState: S;
  /** Rendered as hidden inputs — the payload travels with the submission. */
  payload?: Record<string, string | number | boolean | null | undefined>;
  label: React.ReactNode;
  pendingLabel?: React.ReactNode;
  variant?: ButtonVariant;
  className?: string;
  formClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  /** Extra named inputs submitted with the action (a duration select, a note field). */
  children?: React.ReactNode;
  onSuccess?: (state: S) => void;
  onError?: (message: string, state: S) => void;
}) {
  const { formAction, pending, onSubmit } = useActionForm(action, initialState, { onSuccess, onError });

  return (
    <form action={formAction} onSubmit={onSubmit} className={formClassName ?? "contents"}>
      {Object.entries(payload ?? {}).map(([name, value]) =>
        value === null || value === undefined ? null : (
          <input key={name} type="hidden" name={name} value={String(value)} />
        ),
      )}
      {children}
      <Button type="submit" variant={variant} className={className} disabled={pending || disabled} aria-label={ariaLabel}>
        {pending ? pendingLabel : label}
      </Button>
    </form>
  );
}

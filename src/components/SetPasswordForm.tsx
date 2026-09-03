"use client";

import { useActionState } from "react";
import { setPasswordAction, type SetPasswordState } from "@/app/(member)/set-password/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";

const INITIAL_STATE: SetPasswordState = { error: null };

export default function SetPasswordForm({ callbackUrl }: { callbackUrl: string }) {
  const [state, formAction, pending] = useActionState(setPasswordAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <Field label="New password" help="At least 10 characters. Length matters more than symbols.">
        {(id, describedBy) => (
          <input
            id={id}
            type="password"
            name="password"
            required
            minLength={10}
            autoComplete="new-password"
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>

      <Field label="Confirm password">
        {(id, describedBy) => (
          <input
            id={id}
            type="password"
            name="confirm"
            required
            minLength={10}
            autoComplete="new-password"
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {state.error}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Set password"}
      </Button>
    </form>
  );
}

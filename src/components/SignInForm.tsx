"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/(public)/signin/actions";
import Button from "@/components/ui/Button";
import Field, { inputClass } from "@/components/ui/Field";

const INITIAL_STATE: LoginState = { error: null };

export default function SignInForm({ callbackUrl, defaultEmail }: { callbackUrl: string; defaultEmail?: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
      <input type="hidden" name="callbackUrl" value={callbackUrl} />

      <Field label="Bison email" help="Use your Howard Bison email. This is how you'll sign in.">
        {(id, describedBy) => (
          <input
            id={id}
            type="email"
            name="email"
            required
            autoComplete="email"
            defaultValue={defaultEmail}
            placeholder="yourname@bison.howard.edu"
            aria-describedby={describedBy}
            className={inputClass}
          />
        )}
      </Field>

      <Field label="Password">
        {(id, describedBy) => (
          <input
            id={id}
            type="password"
            name="password"
            required
            autoComplete="current-password"
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
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

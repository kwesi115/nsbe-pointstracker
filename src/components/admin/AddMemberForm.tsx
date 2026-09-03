"use client";

import { useActionState, useEffect } from "react";
import { createMemberAction, type CreateMemberState } from "@/app/(member)/admin/members/actions";
import Button from "@/components/ui/Button";
import { inputClass, selectClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import CopySetupCode from "./CopySetupCode";

const INITIAL_STATE: CreateMemberState = { error: null, result: null };

export default function AddMemberForm() {
  const [state, formAction, pending] = useActionState(createMemberAction, INITIAL_STATE);
  const { show } = useToast();

  useEffect(() => {
    if (state.result) show(`Added ${state.result.email}`);
  }, [state.result, show]);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Email
          <input type="email" name="email" required className={`${inputClass} w-56`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          First name
          <input type="text" name="firstName" required className={`${inputClass} w-36`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Last name
          <input type="text" name="lastName" required className={`${inputClass} w-36`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Role
          <select name="role" defaultValue="general" className={`${selectClass} w-32`}>
            <option value="general">General</option>
            <option value="eboard">E-Board</option>
            <option value="guest">Guest</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? "Adding…" : "Add member"}
        </Button>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {state.error}
        </p>
      ) : null}
      {state.result ? <CopySetupCode email={state.result.email} setupCode={state.result.setupCode} /> : null}
    </div>
  );
}

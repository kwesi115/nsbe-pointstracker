"use client";

import { useActionState } from "react";
import { submitGuestCodeAction, type GuestJoinState } from "@/app/(guest)/guest/join/actions";
import Button from "@/components/ui/Button";
import JoinCodeInput from "@/components/JoinCodeInput";

const INITIAL_STATE: GuestJoinState = { error: null };

export default function GuestJoinForm() {
  const [state, formAction, pending] = useActionState(submitGuestCodeAction, INITIAL_STATE);

  return (
    <form action={formAction} className="flex w-full max-w-xs flex-col gap-4">
      <JoinCodeInput />
      {state.error ? (
        <p role="alert" className="text-center text-sm font-medium text-alert">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}

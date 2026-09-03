"use client";

import { useActionState, useEffect, useState } from "react";
import { resetPasswordAction, type ResetPasswordState } from "@/app/(member)/admin/members/actions";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import CopySetupCode from "./CopySetupCode";

const INITIAL_STATE: ResetPasswordState = { error: null, result: null };

export default function ResetPasswordButton({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState(resetPasswordAction, INITIAL_STATE);
  const [confirming, setConfirming] = useState(false);
  const { show } = useToast();

  useEffect(() => {
    if (state.result) show(`Password reset for ${state.result.email}`);
  }, [state.result, show]);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="secondary" className="text-xs" onClick={() => setConfirming(true)}>
        Reset password
      </Button>
      <ConfirmDialog
        open={confirming}
        title="Reset this member's password?"
        description={`${email} will need a new setup code to sign back in — their current password stops working immediately.`}
        confirmLabel="Reset password"
        tone="danger"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          const fd = new FormData();
          fd.set("email", email);
          formAction(fd);
          setConfirming(false);
        }}
      />
      {state.error ? (
        <p role="alert" className="text-xs font-medium text-alert">
          {state.error}
        </p>
      ) : null}
      {state.result ? <CopySetupCode email={state.result.email} setupCode={state.result.setupCode} /> : null}
    </div>
  );
}

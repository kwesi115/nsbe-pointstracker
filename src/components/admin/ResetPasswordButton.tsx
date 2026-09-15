"use client";

import { useState } from "react";
import { resetPasswordAction, type ResetPasswordState } from "@/app/(member)/admin/members/actions";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import CopySetupCode from "./CopySetupCode";

const INITIAL_STATE: ResetPasswordState = { error: null, result: null };

/**
 * Reset a member's password and show the setup code that replaces it.
 *
 * Always available, whatever state the account is in — including a member
 * who was already reset and is still waiting (see lib/repo.ts resetPassword).
 *
 * The dispatch lives in ConfirmDialog's form action, not in an onClick handler:
 * the confirm button is a real submit button, so React owns the transition,
 * `pending` is genuine, and the button is actually disabled while the reset is
 * in flight. The server collapses a repeat that gets through anyway, handing
 * back the same code rather than a new one.
 */
export default function ResetPasswordButton({ email }: { email: string }) {
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<ResetPasswordState["result"]>(null);
  const { show } = useToast();

  return (
    <div className="flex flex-col items-start gap-2">
      <Button type="button" variant="secondary" className="text-xs" onClick={() => setConfirming(true)}>
        Reset password
      </Button>
      <ConfirmDialog<ResetPasswordState>
        open={confirming}
        title="Reset this member's password?"
        description={
          <>
            <p>
              {email} gets a new setup code. Their current password — and any setup code they already have — stops
              working immediately.
            </p>
            <p className="mt-2 font-medium text-foreground">This replaces any previous code.</p>
          </>
        }
        confirmLabel="Reset password"
        tone="danger"
        action={resetPasswordAction}
        initialState={INITIAL_STATE}
        payload={{ email }}
        onCancel={() => setConfirming(false)}
        onSuccess={(state) => {
          setConfirming(false);
          // Guarded: a success with nothing to show must not wipe the code
          // already on screen.
          if (state.result) {
            setResult(state.result);
            show(state.result.reused ? `Showing the code just issued for ${state.result.email}` : `Password reset for ${state.result.email}`);
          }
        }}
      />
      {result ? (
        <CopySetupCode
          email={result.email}
          setupCode={result.setupCode}
          loginBlocked={result.loginBlocked}
          note={
            result.reused
              ? "A reset for this member was issued seconds ago — this is that same code, not a new one."
              : "This replaces any previous code."
          }
        />
      ) : null}
    </div>
  );
}

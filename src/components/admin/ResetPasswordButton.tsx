"use client";

import { useState } from "react";
import { resetPasswordAction, type ResetPasswordState } from "@/app/(member)/admin/members/actions";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import CopySetupCode from "./CopySetupCode";

const INITIAL_STATE: ResetPasswordState = { error: null, result: null };

/**
 * Reset a member's password and show the one-time setup code that replaces it.
 *
 * The dispatch lives in ConfirmDialog's form action, not in an onClick handler:
 * the confirm button is a real submit button, so React owns the transition,
 * `pending` is genuine, and the button is actually disabled while the reset is
 * in flight. Clicking it twice used to issue two setup codes and leave the
 * first one — the one on screen — dead. (The server now collapses a repeat
 * submission too; see lib/repo.ts resetPassword and its requestToken.)
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
        description={`${email} will need a new setup code to sign back in — their current password stops working immediately.`}
        confirmLabel="Reset password"
        tone="danger"
        action={resetPasswordAction}
        initialState={INITIAL_STATE}
        payload={{ email }}
        onCancel={() => setConfirming(false)}
        onSuccess={(state) => {
          setConfirming(false);
          // Guarded: a collapsed duplicate submission resolves with no result,
          // and must not wipe the code the first one put on screen.
          if (state.result) {
            setResult(state.result);
            show(`Password reset for ${state.result.email}`);
          }
        }}
      />
      {result ? <CopySetupCode email={result.email} setupCode={result.setupCode} /> : null}
    </div>
  );
}

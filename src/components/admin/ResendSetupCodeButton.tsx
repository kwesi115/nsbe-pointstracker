"use client";

import { useState } from "react";
import { resendSetupCodeAction, type ResendSetupCodeState } from "@/app/(member)/admin/members/actions";
import ActionButton from "@/components/ui/ActionButton";
import { useToast } from "@/components/ui/Toast";
import CopySetupCode from "./CopySetupCode";

const INITIAL_STATE: ResendSetupCodeState = { error: null, result: null };

/**
 * "Resend code": shows the member's CURRENT setup code again. Generates nothing
 * and invalidates nothing — the fix for "I closed the dialog" and "they didn't
 * write it down", where a reset would kill a code the member may already have.
 * No confirmation step: nothing about the account changes.
 */
export default function ResendSetupCodeButton({ email }: { email: string }) {
  const [result, setResult] = useState<ResendSetupCodeState["result"]>(null);
  const { show } = useToast();

  return (
    <div className="flex flex-col items-start gap-2">
      <ActionButton<ResendSetupCodeState>
        action={resendSetupCodeAction}
        initialState={INITIAL_STATE}
        payload={{ email }}
        label="Resend code"
        pendingLabel="Loading…"
        variant="secondary"
        className="text-xs"
        onSuccess={(state) => setResult(state.result)}
        onError={(message) => show(message, "error")}
      />
      {result ? (
        <CopySetupCode
          email={result.email}
          setupCode={result.setupCode}
          loginBlocked={result.loginBlocked}
          note="The same code as before — nothing was reset, and nothing the member already has stopped working."
        />
      ) : null}
    </div>
  );
}

"use client";

import { Check, Copy, TriangleAlert } from "lucide-react";
import { useState } from "react";

/**
 * A setup code, for an admin to hand to a member. Rendered EXACTLY as stored:
 * no grouping, hyphens or case changes in the text, and Copy writes the raw
 * code. (Sign-in forgives those anyway — lib/setup-code.ts normalizeSetupCode —
 * but what's on screen must never be something the member has to undo.)
 *
 * Used by AddMemberForm, MemberImport's callers, ResetPasswordButton and
 * ResendSetupCodeButton. The code can be shown again from the member's page
 * until they choose a password.
 */
export default function CopySetupCode({
  email,
  setupCode,
  note,
  loginBlocked = false,
}: {
  email: string;
  setupCode: string;
  /** One line under the code — e.g. "This replaces any previous code." */
  note?: React.ReactNode;
  /** The email can't pass the sign-in domain gate, so this code will be rejected until it's allowed. */
  loginBlocked?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex max-w-md flex-col gap-2 rounded-lg border border-torch bg-torch/10 p-3 text-sm text-foreground">
      <p>
        Setup code for <strong className="break-all">{email}</strong>. They sign in with their email and this code as
        the password, then choose a new password.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="numeric select-all rounded bg-foreground/10 px-3 py-2 text-2xl font-bold">{setupCode}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(setupCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex min-h-11 items-center gap-1 rounded border border-border px-3 py-1 text-xs font-medium hover:bg-surface"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      {loginBlocked ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-alert">
          <TriangleAlert size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          This email can&apos;t sign in: it isn&apos;t on the allowed email domain or the admin email allowlist, so this
          code will be rejected. Add the address to the allowlist in Settings first.
        </p>
      ) : null}
    </div>
  );
}

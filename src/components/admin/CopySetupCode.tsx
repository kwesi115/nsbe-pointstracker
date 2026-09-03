"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/**
 * Renders a setup code exactly once, right after it's generated. The caller
 * (AddMemberForm / ResetPasswordButton) only has this value in transient
 * useActionState — it's never re-fetched or re-displayed after this unmounts.
 */
export default function CopySetupCode({ email, setupCode }: { email: string; setupCode: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-lg border border-amber bg-amber/10 p-3 text-sm text-ink">
      <p>
        Setup code for <strong>{email}</strong> — write it down now, it won&apos;t be shown again:
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="numeric rounded bg-ink/10 px-2 py-1 text-base tracking-widest">{setupCode}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(setupCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex min-h-8 items-center gap-1 rounded border border-line px-2 py-1 text-xs font-medium hover:bg-white"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

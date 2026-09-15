import { formatDateTime } from "@/lib/format";
import type { AccountAccess } from "@/lib/repo";
import AccountStateBadge from "./AccountStateBadge";
import ResendSetupCodeButton from "./ResendSetupCodeButton";
import ResetPasswordButton from "./ResetPasswordButton";

/**
 * /admin/members/[id]: whether this member can get in, at a glance — Active,
 * Setup pending or Reset pending; when the last code was issued and by whom;
 * and the two recovery tools. Reset is always offered. Resend only when there
 * is a pending code to show again.
 */
export default function AccountAccessPanel({ email, access }: { email: string; access: AccountAccess }) {
  const pending = access.state !== "active";

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <AccountStateBadge state={access.state} />
        <span className="text-muted">
          {pending ? "Waiting on a setup code — they haven't chosen a password yet." : "Signs in with their own password."}
        </span>
      </div>

      <p className="text-muted">
        {access.lastIssued ? (
          <>
            {access.lastIssued.action === "reset_password" ? "Last reset" : "Account created"}{" "}
            <span className="text-foreground">{formatDateTime(access.lastIssued.at)}</span> by{" "}
            <span className="text-foreground">{access.lastIssued.actor || "system"}</span>
          </>
        ) : (
          "No reset on record."
        )}
      </p>

      {!access.loginAllowed ? (
        <p role="alert" className="font-medium text-alert">
          This email can&apos;t sign in: it isn&apos;t on the allowed email domain or the admin email allowlist. No
          password or setup code will work until the address is added to the allowlist in Settings.
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-3">
        <ResetPasswordButton email={email} />
        {pending && access.codeRetrievable ? <ResendSetupCodeButton email={email} /> : null}
      </div>

      {pending && !access.codeRetrievable ? (
        <p className="text-xs text-muted">
          This member&apos;s code was issued before codes could be shown again, so there&apos;s nothing to resend. Reset
          to issue one you can show again later.
        </p>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { changePasswordAction } from "@/app/(member)/account/actions";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field, { inputClass } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";

/** Email (locked), change password, and the season label. */
export default function AccountSection({ email, season }: { email: string; season: string }) {
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { show } = useToast();

  function resetPasswordForm() {
    setChangingPassword(false);
    setError(null);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await changePasswordAction(currentPassword, newPassword, confirmPassword);
      if (result.error) {
        setError(result.error);
      } else {
        show("Password changed");
        resetPasswordForm();
      }
    });
  }

  return (
    <section id="account" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Account</h2>
      <Card>
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs text-muted">Bison email</p>
            <p className="text-sm text-ink">{email}</p>
            <p className="mt-0.5 text-xs text-muted">
              Your Bison email is your login and can&apos;t be changed. Contact an E-Board member if you need it updated.
            </p>
          </div>
          <div>
            <p className="text-xs text-muted">Season</p>
            <p className="text-sm text-ink">{season || "—"}</p>
          </div>

          {!changingPassword ? (
            <Button type="button" variant="secondary" onClick={() => setChangingPassword(true)} className="self-start">
              Change password
            </Button>
          ) : (
            <div className="flex flex-col gap-3 border-t border-line pt-4">
              <Field label="Current password">
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="New password" help="At least 10 characters.">
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={inputClass}
                  />
                )}
              </Field>
              <Field label="Confirm new password">
                {(id) => (
                  <input
                    id={id}
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={inputClass}
                  />
                )}
              </Field>
              {error ? (
                <p role="alert" className="text-sm font-medium text-alert">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={resetPasswordForm} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="button" onClick={save} disabled={isPending || !currentPassword || !newPassword}>
                  {isPending ? "Saving…" : "Save password"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </Card>
    </section>
  );
}

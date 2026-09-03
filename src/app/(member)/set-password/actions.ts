"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { setPassword } from "@/lib/repo";
import { validatePasswordStrength } from "@/lib/passwords";
import { requireSession } from "@/lib/session";

export interface SetPasswordState {
  error: string | null;
}

export async function setPasswordAction(
  _prevState: SetPasswordState,
  formData: FormData,
): Promise<SetPasswordState> {
  const session = await requireSession();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/events");

  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  const strength = validatePasswordStrength(password);
  if (!strength.ok) {
    return { error: strength.message ?? "That password isn't strong enough." };
  }

  await setPassword(session.user.orgId, session.user.email, password);

  // The existing session cookie still has mustChangePassword=true baked in from
  // sign-in time — middleware reads that raw JWT claim directly, not a fresh
  // workbook read. Signing back in with the new password mints a fresh token
  // with the flag correctly cleared, so this doesn't bounce right back here.
  try {
    await signIn("credentials", { email: session.user.email, password, orgId: session.user.orgId, redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Password saved, but signing you back in failed. Try signing in again." };
    }
    throw error;
  }

  return { error: null };
}

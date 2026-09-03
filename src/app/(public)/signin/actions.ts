"use server";

import { cookies } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";
import { AppError } from "@/lib/errors";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { requireOrgContext } from "@/lib/org";

export interface LoginState {
  error: string | null;
}

export async function loginAction(_prevState: LoginState, formData: FormData): Promise<LoginState> {
  // Server-resolved from the httpOnly cookie, never a form field — redirects
  // to "/" if it's missing (Part 6).
  const { orgId } = await requireOrgContext();

  // Belt-and-suspenders alongside auth.ts's signIn callback (Part 3): a
  // successful sign-in can never leave a guest_pass behind. Cleared up front
  // since signIn() below redirects (throws) on success, never returning
  // control to code that follows it.
  const store = await cookies();
  store.delete(GUEST_PASS_COOKIE);

  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const callbackUrl = String(formData.get("callbackUrl") ?? "/events");

  try {
    await signIn("credentials", { email, password, orgId, redirectTo: callbackUrl });
  } catch (error) {
    if (error instanceof AuthError) {
      // TooManyAttemptsSignin (auth.ts) wraps the original AppError as the cause —
      // unwrap it for the exact "try again in N minutes" message. Everything else,
      // including a bare failed-credentials CredentialsSignin, gets the same
      // generic line: never hint whether the email was on the roster.
      const cause = error.cause?.err;
      if (cause instanceof AppError && cause.code === "TOO_MANY_ATTEMPTS") {
        return { error: cause.message };
      }
      return { error: "That email and password don't match." };
    }
    throw error;
  }

  return { error: null };
}

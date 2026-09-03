"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { signOut } from "@/auth";
import { AppError } from "@/lib/errors";
import { setGuestPassCookie } from "@/lib/guest-pass";
import { requireOrgContext } from "@/lib/org";
import { assertNotJoinCodeRateLimited, recordJoinCodeAttempt } from "@/lib/rate-limit";
import { redeemGuestJoinCode } from "@/lib/repo";

export interface GuestJoinState {
  error: string | null;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return h.get("x-real-ip")?.trim() || "unknown";
}

/** Same rate limit as /join (Part 5) — a guest code and a member code are the same kind of secret. */
export async function submitGuestCodeAction(_prev: GuestJoinState, formData: FormData): Promise<GuestJoinState> {
  const { orgId } = await requireOrgContext();
  const ip = await clientIp();

  try {
    assertNotJoinCodeRateLimited(ip);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  recordJoinCodeAttempt(ip);

  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { error: "That join code doesn't work. Check it and try again." };

  // Only a GUEST-granting code can succeed here — an ADMIN/EBOARD/GENERAL
  // code fails with the identical generic message (see lib/repo.ts
  // redeemGuestJoinCode).
  const label = await redeemGuestJoinCode(orgId, code);
  if (!label) return { error: "That join code doesn't work. Check it and try again." };

  // (guest)/layout.tsx already turns away anyone with a session before they
  // reach this action (Part 2) — this is defense in depth against a future
  // route that skips that guard, not a path this action expects to hit in
  // practice (Part 3).
  await signOut({ redirect: false });
  await setGuestPassCookie(orgId);
  redirect("/guest/events");
}

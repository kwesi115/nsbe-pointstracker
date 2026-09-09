"use server";

import { revalidatePath } from "next/cache";
import { normalizeEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { requireVerificationsWriteAction } from "@/lib/permissions";
import { rejectHouse, revokeDues, revokeNational, verifyDues, verifyHouse, verifyNational } from "@/lib/repo";

export type VerificationQueueTab = "dues" | "national" | "house";

async function run(fn: () => Promise<void>): Promise<{ error: string | null }> {
  try {
    await fn();
    revalidatePath("/admin/verifications");
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function approveAction(tab: VerificationQueueTab, email: string): Promise<{ error: string | null }> {
  const session = await requireVerificationsWriteAction();
  const orgId = session.user.orgId;
  const actor = session.user.email;
  const e = normalizeEmail(email);
  if (tab === "dues") return run(() => verifyDues(orgId, e, actor));
  if (tab === "national") return run(() => verifyNational(orgId, e, actor));
  return run(() => verifyHouse(orgId, e, actor));
}

/** House keeps the plain reject flow (note optional, unchanged). Dues/national go through revokeAction instead — a note is required there. */
export async function rejectAction(email: string, note?: string): Promise<{ error: string | null }> {
  const session = await requireVerificationsWriteAction();
  const actor = session.user.email;
  const e = normalizeEmail(email);
  return run(() => rejectHouse(session.user.orgId, e, actor, note));
}

/** Dues/national only — requires a note, drops the member from the leaderboard immediately (see lib/repo.ts revokeDues/revokeNational). */
export async function revokeAction(
  tab: "dues" | "national",
  email: string,
  note: string,
): Promise<{ error: string | null }> {
  const session = await requireVerificationsWriteAction();
  const orgId = session.user.orgId;
  const actor = session.user.email;
  const e = normalizeEmail(email);
  if (!note.trim()) return { error: "A note is required to revoke a claim." };
  if (tab === "dues") return run(() => revokeDues(orgId, e, actor, note));
  return run(() => revokeNational(orgId, e, actor, note));
}

/** Bulk approve — same per-item action, just looped, so one bad row doesn't block the rest. */
export async function bulkApproveAction(tab: VerificationQueueTab, emails: string[]): Promise<{ error: string | null }> {
  for (const email of emails) {
    const result = await approveAction(tab, email);
    if (result.error) return result;
  }
  return { error: null };
}

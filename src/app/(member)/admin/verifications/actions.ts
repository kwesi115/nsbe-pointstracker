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

/**
 * Every mutation below takes `(prevState, formData)` — the shape React can own
 * a transition for, so the confirm dialogs and row buttons that dispatch them
 * (components/ui/ConfirmDialog.tsx, ActionButton.tsx) get a real `pending` and
 * cannot double-fire. The bulk loop calls the internal helpers, not the form
 * actions, because it has no form.
 */
export interface VerificationActionState {
  error: string | null;
}

const VALID_TABS: VerificationQueueTab[] = ["dues", "national", "house"];

function tabFrom(formData: FormData): VerificationQueueTab | null {
  const tab = String(formData.get("tab") ?? "");
  return VALID_TABS.includes(tab as VerificationQueueTab) ? (tab as VerificationQueueTab) : null;
}

async function approveOne(tab: VerificationQueueTab, email: string): Promise<{ error: string | null }> {
  const session = await requireVerificationsWriteAction();
  const orgId = session.user.orgId;
  const actor = session.user.email;
  const e = normalizeEmail(email);
  if (tab === "dues") return run(() => verifyDues(orgId, e, actor));
  if (tab === "national") return run(() => verifyNational(orgId, e, actor));
  return run(() => verifyHouse(orgId, e, actor));
}

export async function approveAction(_prev: VerificationActionState, formData: FormData): Promise<VerificationActionState> {
  const tab = tabFrom(formData);
  if (!tab) return { error: "Unknown claim type." };
  return approveOne(tab, String(formData.get("email") ?? ""));
}

/** House keeps the plain reject flow (note optional, unchanged). Dues/national go through revokeAction instead — a note is required there. */
export async function rejectAction(_prev: VerificationActionState, formData: FormData): Promise<VerificationActionState> {
  const session = await requireVerificationsWriteAction();
  const actor = session.user.email;
  const e = normalizeEmail(String(formData.get("email") ?? ""));
  const note = String(formData.get("reason") ?? "").trim() || undefined;
  return run(() => rejectHouse(session.user.orgId, e, actor, note));
}

/** Dues/national only — requires a note, drops the member from the leaderboard immediately (see lib/repo.ts revokeDues/revokeNational). */
export async function revokeAction(_prev: VerificationActionState, formData: FormData): Promise<VerificationActionState> {
  const session = await requireVerificationsWriteAction();
  const orgId = session.user.orgId;
  const actor = session.user.email;
  const tab = tabFrom(formData);
  if (tab !== "dues" && tab !== "national") return { error: "Only a dues or national claim can be revoked." };
  const e = normalizeEmail(String(formData.get("email") ?? ""));
  const note = String(formData.get("reason") ?? "");
  if (!note.trim()) return { error: "A note is required to revoke a claim." };
  if (tab === "dues") return run(() => revokeDues(orgId, e, actor, note));
  return run(() => revokeNational(orgId, e, actor, note));
}

/** Bulk approve — same per-item work, just looped, so one bad row doesn't block the rest. */
export async function bulkApproveAction(tab: VerificationQueueTab, emails: string[]): Promise<{ error: string | null }> {
  for (const email of emails) {
    const result = await approveOne(tab, email);
    if (result.error) return result;
  }
  return { error: null };
}

"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { logSystemAdminEvent } from "@/lib/repo";
import { requireEboard } from "@/lib/session";
import { writeSeasonSnapshot } from "@/lib/export/snapshot";

export interface CreateSnapshotResult {
  error: string | null;
}

/**
 * The manual half of Layer 2 (see docs/RECOVERY.md) — an on-demand,
 * human-readable full-workbook backup, independent of the nightly pg_dump
 * cron. Also called (with a `reason`) right before a destructive admin
 * action — see MemberImport.tsx and admin/settings/categories/actions.ts.
 */
export async function createSnapshotAction(reason?: string): Promise<CreateSnapshotResult> {
  const session = await requireEboard();
  try {
    const result = await writeSeasonSnapshot(session.user.orgId);
    await logSystemAdminEvent(session.user.orgId, {
      actor: session.user.email,
      action: "create_season_snapshot",
      target: result.key,
      detail: reason ? `${result.bytes} bytes — ${reason}` : `${result.bytes} bytes`,
    });
    revalidatePath("/admin/exports");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/**
 * The same snapshot, dispatched from a button (components/ui/ActionButton.tsx)
 * rather than called from other server code. Kept separate from the function
 * above because that one is also called internally — from a bulk import, and
 * from a category edit — where there is no form to submit.
 */
export async function createSnapshotFormAction(
  _prev: CreateSnapshotResult,
  formData: FormData,
): Promise<CreateSnapshotResult> {
  const reason = String(formData.get("reason") ?? "").trim();
  return createSnapshotAction(reason || undefined);
}

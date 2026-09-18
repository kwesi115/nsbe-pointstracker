"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import {
  createPointAdjustments,
  previewPointAdjustment,
  revokePointAdjustment,
  type AdjustmentImpact,
} from "@/lib/repo";

/**
 * Point adjustments — gated on points_write (see lib/access.ts
 * PERMISSION_ROLES), NOT attendance_write and NOT bare ADMIN: fixing an
 * attendance typo and moving someone on the leaderboard are different trusts.
 * Every action re-checks the permission live; none trusts the page it came
 * from.
 */

export interface AdjustmentActionState {
  error: string | null;
  /** How many members the adjustment landed on — the bulk toast's count. */
  adjusted?: number;
}

function failed(err: unknown): AdjustmentActionState {
  if (err instanceof AppError) return { error: err.message };
  throw err;
}

/** Read-only impact preview — current/new total and current/projected rank for every target. Called as the amount changes, before anything is written. */
export async function previewAdjustmentAction(
  emails: string[],
  points: number,
): Promise<{ impact: AdjustmentImpact | null; error: string | null }> {
  try {
    const session = await requirePermission("points_write");
    if (!Number.isInteger(points) || points === 0) return { impact: null, error: null };
    return { impact: await previewPointAdjustment(session.user.orgId, emails, points), error: null };
  } catch (err) {
    if (err instanceof AppError) return { impact: null, error: err.message };
    throw err;
  }
}

/** One member (from /admin/members/[id]) or many (the directory's bulk action) — the selection travels as repeated `emails` fields, the shared reason as `adjustmentReason`. */
export async function adjustPointsAction(_prev: AdjustmentActionState, formData: FormData): Promise<AdjustmentActionState> {
  try {
    const session = await requirePermission("points_write");
    const emails = formData.getAll("emails").map((e) => String(e));
    const points = Number(formData.get("points"));
    const reason = String(formData.get("adjustmentReason") ?? "");
    const relatedEventId = String(formData.get("relatedEventId") ?? "").trim() || null;
    const created = await createPointAdjustments({
      orgId: session.user.orgId,
      emails,
      points,
      reason,
      relatedEventId,
      actor: session.user.email,
    });
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    revalidatePath("/admin/awards");
    return { error: null, adjusted: created.length };
  } catch (err) {
    return failed(err);
  }
}

export async function revokeAdjustmentAction(_prev: AdjustmentActionState, formData: FormData): Promise<AdjustmentActionState> {
  try {
    const session = await requirePermission("points_write");
    await revokePointAdjustment(
      session.user.orgId,
      String(formData.get("id") ?? ""),
      session.user.email,
      String(formData.get("reason") ?? ""),
    );
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    revalidatePath("/admin/awards");
    return { error: null };
  } catch (err) {
    return failed(err);
  }
}

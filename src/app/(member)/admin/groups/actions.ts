"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { createEventGroup, finalizeEventGroup, setEventGroup, updateEventGroupTiers } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import type { BonusTier } from "@/lib/types";

export interface GroupActionState {
  error: string | null;
}

/** bonusTiers is edited as raw JSON — e.g. [{"min":3,"max":4,"bonus":3},{"min":5,"max":null,"bonus":5}]. Data, not code, per the spec: an admin edits this directly if NSBE Week runs a different number of events one year. */
function parseTiers(raw: string): BonusTier[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("VALIDATION_FAILED", 'Bonus tiers must be valid JSON, e.g. [{"min":3,"max":4,"bonus":3}].');
  }
  if (!Array.isArray(parsed)) throw new AppError("VALIDATION_FAILED", "Bonus tiers must be a JSON array.");
  return parsed.map((t): BonusTier => {
    if (typeof t !== "object" || t === null || typeof (t as Record<string, unknown>).min !== "number" || typeof (t as Record<string, unknown>).bonus !== "number") {
      throw new AppError("VALIDATION_FAILED", "Each tier needs numeric min and bonus fields (max is optional).");
    }
    const record = t as Record<string, unknown>;
    return { min: record.min as number, max: typeof record.max === "number" ? record.max : null, bonus: record.bonus as number };
  });
}

export async function createGroupAction(_prevState: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const session = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const expectedEventCount = Number(formData.get("expectedEventCount") ?? 5);
  const tiersRaw = String(formData.get("bonusTiers") ?? "[]");
  if (!name) return { error: "Name is required." };

  try {
    const bonusTiers = parseTiers(tiersRaw);
    await createEventGroup({
      orgId: session.user.orgId,
      name,
      expectedEventCount,
      bonusTiers,
      createdBy: session.user.email,
    });
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/groups");
  return { error: null };
}

export async function updateTiersAction(
  groupId: string,
  _prevState: GroupActionState,
  formData: FormData,
): Promise<GroupActionState> {
  const session = await requireAdmin();
  const tiersRaw = String(formData.get("bonusTiers") ?? "[]");
  try {
    const bonusTiers = parseTiers(tiersRaw);
    await updateEventGroupTiers(session.user.orgId, groupId, bonusTiers, session.user.email);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/admin/groups/${groupId}`);
  return { error: null };
}

export async function toggleEventInGroupAction(
  eventId: string,
  groupId: string | null,
): Promise<{ error: string | null }> {
  const session = await requireAdmin();
  try {
    await setEventGroup(session.user.orgId, eventId, groupId, session.user.email);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/groups");
  return { error: null };
}

export async function finalizeGroupAction(_prev: GroupActionState, formData: FormData): Promise<GroupActionState> {
  const session = await requireAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  try {
    await finalizeEventGroup(session.user.orgId, groupId, session.user.email);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  revalidatePath(`/admin/groups/${groupId}`);
  return { error: null };
}

"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { calculateMonthlyChampions, createManualAward, previewMonthlyChampions, revokePointAward } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";

export interface AwardActionState {
  error: string | null;
}

export async function createManualAwardAction(_prevState: AwardActionState, formData: FormData): Promise<AwardActionState> {
  const session = await requireAdmin();
  const email = String(formData.get("email") ?? "").trim();
  const points = Number(formData.get("points") ?? 0);
  const reason = String(formData.get("reason") ?? "").trim();
  if (!email || !reason) return { error: "Email and reason are required." };

  try {
    await createManualAward({ orgId: session.user.orgId, email, points, reason, actor: session.user.email });
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/awards");
  return { error: null };
}

export async function revokeAwardAction(_prev: AwardActionState, formData: FormData): Promise<AwardActionState> {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("reason") ?? "");
  if (!note.trim()) return { error: "A note is required to revoke an award." };
  try {
    await revokePointAward(session.user.orgId, id, session.user.email, note);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
  revalidatePath("/admin/awards");
  return { error: null };
}

export interface ChampionPreviewResult {
  error: string | null;
  champions: Array<{ email: string; firstName: string; lastName: string; count: number }>;
  alreadyMaterialized: string[];
}

/** Read-only — the "recalculating shows a diff" confirmation the spec calls for. */
export async function previewChampionsAction(month: string): Promise<ChampionPreviewResult> {
  const session = await requireAdmin();
  if (!month) return { error: "Pick a month.", champions: [], alreadyMaterialized: [] };
  const preview = await previewMonthlyChampions(session.user.orgId, month);
  return { error: null, ...preview };
}

export interface CalculateChampionsResult {
  error: string | null;
  awarded: string[];
  revoked: string[];
  unchanged: boolean;
}

export async function calculateChampionsAction(month: string, points: number): Promise<CalculateChampionsResult> {
  const session = await requireAdmin();
  try {
    const result = await calculateMonthlyChampions(session.user.orgId, month, points, session.user.email);
    revalidatePath("/admin/awards");
    return { error: null, ...result };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, awarded: [], revoked: [], unchanged: false };
    throw err;
  }
}

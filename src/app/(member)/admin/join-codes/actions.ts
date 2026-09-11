"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { createJoinCode, deactivateJoinCode, rotateJoinCodeById, updateJoinCodeLimits } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import type { Role } from "@/lib/types";

export interface JoinCodeActionState {
  error: string | null;
  plaintext?: string;
}

const VALID_ROLES: Role[] = ["admin", "eboard", "general", "guest"];

export async function createJoinCodeAction(_prev: JoinCodeActionState, formData: FormData): Promise<JoinCodeActionState> {
  const session = await requireAdmin();
  const label = String(formData.get("label") ?? "").trim();
  const grantsRole = String(formData.get("grantsRole") ?? "") as Role;
  const maxUsesRaw = String(formData.get("maxUses") ?? "").trim();
  const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();

  if (!label) return { error: "Label is required." };
  if (!VALID_ROLES.includes(grantsRole)) return { error: "Pick a role." };

  try {
    const result = await createJoinCode({
      orgId: session.user.orgId,
      label,
      grantsRole,
      maxUses: maxUsesRaw ? Number(maxUsesRaw) : null,
      expiresAt: expiresAtRaw ? new Date(expiresAtRaw) : null,
      createdBy: session.user.email,
    });
    revalidatePath("/admin/join-codes");
    return { error: null, plaintext: result.plaintext };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/**
 * Rotating a code generates a credential, so this is the second action with a
 * request token (see lib/repo.ts rotateJoinCodeById): two submissions of one
 * confirmation rotate the code ONCE, instead of the second rotation quietly
 * invalidating the plaintext the admin is still copying off the screen.
 */
export async function rotateJoinCodeAction(_prev: JoinCodeActionState, formData: FormData): Promise<JoinCodeActionState> {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const requestToken = String(formData.get("requestToken") ?? "") || undefined;
  try {
    const result = await rotateJoinCodeById(session.user.orgId, id, session.user.email, { requestToken });
    revalidatePath("/admin/join-codes");
    return { error: null, plaintext: result.plaintext };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function deactivateJoinCodeAction(
  _prev: JoinCodeActionState,
  formData: FormData,
): Promise<JoinCodeActionState> {
  const session = await requireAdmin();
  try {
    await deactivateJoinCode(session.user.orgId, String(formData.get("id") ?? ""), session.user.email);
    revalidatePath("/admin/join-codes");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function updateJoinCodeLimitsAction(
  id: string,
  input: { expiresAt: Date | null; maxUses: number | null },
): Promise<{ error: string | null }> {
  const session = await requireAdmin();
  try {
    await updateJoinCodeLimits({ orgId: session.user.orgId, id, ...input, actor: session.user.email });
    revalidatePath("/admin/join-codes");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { normalizeEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import {
  approveMember,
  commitBulkImport,
  correctHouse,
  createMemberAccount,
  grantPermission,
  previewBulkImport,
  rejectMember,
  resetPassword,
  revokePermission,
  setEboardPosition,
  setMemberRole,
  updateProfileFields,
  verifyDues,
  verifyNational,
  type BulkImportPreview,
  type BulkImportRow,
  type ProfileFieldsInput,
} from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import type { PermissionName, Role } from "@/lib/types";

export interface CreateMemberState {
  error: string | null;
  result: { email: string; setupCode: string } | null;
}

export async function createMemberAction(
  _prevState: CreateMemberState,
  formData: FormData,
): Promise<CreateMemberState> {
  const session = await requireAdmin();

  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const role = String(formData.get("role") ?? "general") as Role;

  if (!email || !firstName || !lastName) {
    return { error: "Email, first name, and last name are required.", result: null };
  }

  try {
    const { setupCode } = await createMemberAccount(session.user.orgId, email, firstName, lastName, role, session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null, result: { email, setupCode } };
  } catch (err) {
    if (err instanceof AppError) {
      return { error: err.message, result: null };
    }
    throw err;
  }
}

export interface ResetPasswordState {
  error: string | null;
  result: { email: string; setupCode: string } | null;
}

export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const session = await requireAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  // Minted per confirm-dialog opening (components/ui/ConfirmDialog.tsx). Two
  // submissions of one confirmation carry the same token, and lib/repo.ts
  // resetPassword issues ONE code for them — so the admin is never shown a
  // setup code that a second request has already invalidated.
  const requestToken = String(formData.get("requestToken") ?? "") || undefined;

  try {
    const setupCode = await resetPassword(session.user.orgId, email, session.user.email, { requestToken });
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null, result: { email, setupCode } };
  } catch (err) {
    if (err instanceof AppError) {
      return { error: err.message, result: null };
    }
    throw err;
  }
}

/**
 * Every mutation below takes `(prevState, formData)`: they are dispatched by a
 * form submit (ConfirmDialog / ActionButton), which is the only way React owns
 * the transition and reports a `pending` the submit control can trust.
 */
export interface MemberActionState {
  error: string | null;
}

const VALID_ROLES: Role[] = ["general", "eboard", "admin", "guest"];

export async function setRoleAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const session = await requireAdmin();
  const email = String(formData.get("email") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!VALID_ROLES.includes(role)) return { error: "Unknown role." };
  try {
    await setMemberRole(session.user.orgId, normalizeEmail(email), role, session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function approveMemberAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const session = await requireAdmin();
  try {
    await approveMember(session.user.orgId, normalizeEmail(String(formData.get("email") ?? "")), session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function rejectMemberAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const session = await requireAdmin();
  try {
    await rejectMember(session.user.orgId, normalizeEmail(String(formData.get("email") ?? "")), session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/** The only path to change a House once it's verified — see lib/repo.ts correctHouse. Requires a note, same shape as revokeAction in admin/verifications/actions.ts. */
export async function correctHouseAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const session = await requireAdmin();
  const email = String(formData.get("email") ?? "");
  const house = String(formData.get("house") ?? "");
  const note = String(formData.get("reason") ?? "");
  if (!house) return { error: "Pick a House." };
  if (!note.trim()) return { error: "A note is required to change a member's House." };
  try {
    await correctHouse(session.user.orgId, normalizeEmail(email), house, note, session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/** Displayed on the internal E-Board leaderboard only — see Part 4. */
export async function setEboardPositionAction(email: string, position: string): Promise<{ error: string | null }> {
  const session = await requireAdmin();
  try {
    await setEboardPosition(session.user.orgId, normalizeEmail(email), position, session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function previewImportAction(rows: BulkImportRow[]): Promise<BulkImportPreview> {
  const session = await requireAdmin();
  return previewBulkImport(session.user.orgId, rows);
}

export interface CommitImportResult {
  error: string | null;
  created: Array<{ email: string; setupCode: string }>;
  skipped: number;
}

/**
 * Dispatched from the import confirmation dialog, so the parsed rows travel in
 * a hidden field as JSON rather than being closed over by a click handler --
 * same reason as every other mutation here. No request token: creating the same
 * account twice is already impossible (User.email is unique, and
 * commitBulkImport counts an existing row as skipped rather than failing).
 */
export async function commitImportAction(_prev: CommitImportResult, formData: FormData): Promise<CommitImportResult> {
  const session = await requireAdmin();
  let rows: BulkImportRow[];
  try {
    const parsed = JSON.parse(String(formData.get("rows") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("not an array");
    rows = parsed as BulkImportRow[];
  } catch {
    return { error: "Couldn't read the parsed rows — re-upload the file.", created: [], skipped: 0 };
  }

  try {
    const result = await commitBulkImport(session.user.orgId, rows, session.user.email);
    revalidatePath("/admin/members");
    return { error: null, ...result };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, created: [], skipped: 0 };
    throw err;
  }
}

/** Bulk actions (Part 5) — thin loops over the existing single-item repo functions, same shape as bulkApproveAction in admin/verifications/actions.ts. One bad row doesn't block the rest. */
async function bulkRun(
  emails: string[],
  fn: (orgId: string, email: string, actor: string) => Promise<unknown>,
): Promise<{ error: string | null }> {
  const session = await requireAdmin();
  for (const email of emails) {
    try {
      await fn(session.user.orgId, normalizeEmail(email), session.user.email);
    } catch (err) {
      if (err instanceof AppError) return { error: `${email}: ${err.message}` };
      throw err;
    }
  }
  revalidatePath("/admin/members");
  return { error: null };
}

export async function bulkVerifyDuesAction(emails: string[]): Promise<{ error: string | null }> {
  return bulkRun(emails, verifyDues);
}

export async function bulkVerifyNationalAction(emails: string[]): Promise<{ error: string | null }> {
  return bulkRun(emails, verifyNational);
}

export async function bulkSetRoleAction(emails: string[], role: Role): Promise<{ error: string | null }> {
  return bulkRun(emails, (orgId, email, actor) => setMemberRole(orgId, email, role, actor));
}

/** /admin/members/[id] Profile panel — same updateProfileFields mutator /account uses for self-service, actor is the admin instead (Part 5). */
export async function adminUpdateProfileAction(email: string, fields: ProfileFieldsInput): Promise<{ error: string | null }> {
  const session = await requireAdmin();
  try {
    await updateProfileFields(session.user.orgId, normalizeEmail(email), fields, session.user.email);
    revalidatePath("/admin/members");
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/** /admin/members/[id] Permissions panel — ADMIN only, same as every other member-management action here (see lib/permissions.ts for the engine this grants into). */
const VALID_PERMISSIONS: PermissionName[] = ["verifications_write", "attendance_write"];

function permissionFrom(formData: FormData): PermissionName | null {
  const value = String(formData.get("permission") ?? "") as PermissionName;
  return VALID_PERMISSIONS.includes(value) ? value : null;
}

export async function grantPermissionAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const session = await requireAdmin();
  const email = String(formData.get("email") ?? "");
  const permission = permissionFrom(formData);
  if (!permission) return { error: "Unknown permission." };
  try {
    await grantPermission(session.user.orgId, normalizeEmail(email), permission, session.user.email);
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function revokePermissionAction(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const session = await requireAdmin();
  const email = String(formData.get("email") ?? "");
  const permission = permissionFrom(formData);
  if (!permission) return { error: "Unknown permission." };
  try {
    await revokePermission(session.user.orgId, normalizeEmail(email), permission, session.user.email);
    revalidatePath("/admin/members/[id]", "page");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

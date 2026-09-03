"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { validatePasswordStrength } from "@/lib/passwords";
import {
  changePassword,
  clearHouseAssignment,
  removeResume,
  setDuesReported,
  setHouseAssignment,
  setNationalReported,
  setResume,
  updateProfileFields,
  type ProfileFieldsInput,
} from "@/lib/repo";
import { requireSession } from "@/lib/session";

interface ActionResult {
  error: string | null;
}

async function run(fn: () => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/account");
    revalidatePath("/dashboard");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/** Phone and personal email are required (Part 2) — ProfileSection.tsx always submits both, so a blank one here means the client check was bypassed. */
export async function updateProfileAction(fields: ProfileFieldsInput): Promise<ActionResult> {
  const session = await requireSession();
  if (fields.phone !== undefined && !fields.phone.trim()) return { error: "Phone is required." };
  if (fields.personalEmail !== undefined && !fields.personalEmail.trim()) return { error: "Personal email is required." };
  return run(() => updateProfileFields(session.user.orgId, session.user.email, fields, session.user.email));
}

/** "Mark as paid" — same effect as answering Yes at check-in (see lib/repo.ts setDuesReported). */
export async function reportDuesAction(): Promise<ActionResult> {
  const session = await requireSession();
  return run(() => setDuesReported(session.user.orgId, session.user.email, true, session.user.email));
}

export async function reportNationalAction(): Promise<ActionResult> {
  const session = await requireSession();
  return run(() => setNationalReported(session.user.orgId, session.user.email, true, session.user.email));
}

/** Only reachable while unverified — a verified House can only change through an admin correction (/admin/members/[id]). */
export async function setHouseAction(house: string, houseProofFileId: string): Promise<ActionResult> {
  const session = await requireSession();
  return run(() => setHouseAssignment(session.user.orgId, session.user.email, house, houseProofFileId, session.user.email));
}

/** "I haven't taken the test yet" — clears any unverified House so a member can back out of a partial or previously-submitted assignment. */
export async function skipHouseAction(): Promise<ActionResult> {
  const session = await requireSession();
  return run(() => clearHouseAssignment(session.user.orgId, session.user.email, session.user.email));
}

export async function replaceResumeAction(resumeFileId: string): Promise<ActionResult> {
  const session = await requireSession();
  return run(() => setResume(session.user.orgId, session.user.email, resumeFileId, session.user.email));
}

/** Withdraws consent — see lib/repo.ts removeResume. */
export async function removeResumeAction(): Promise<ActionResult> {
  const session = await requireSession();
  return run(() => removeResume(session.user.orgId, session.user.email, session.user.email));
}

export async function changePasswordAction(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<ActionResult> {
  const session = await requireSession();
  if (newPassword !== confirmPassword) return { error: "New passwords don't match." };
  const strength = validatePasswordStrength(newPassword);
  if (!strength.ok) return { error: strength.message ?? "That password isn't strong enough." };
  return run(() => changePassword(session.user.orgId, session.user.email, currentPassword, newPassword));
}

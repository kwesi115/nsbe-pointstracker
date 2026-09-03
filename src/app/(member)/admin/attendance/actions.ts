"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { addManualAttendance, deleteAttendance } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export interface AddAttendanceState {
  error: string | null;
}

export async function addAttendanceAction(_prevState: AddAttendanceState, formData: FormData): Promise<AddAttendanceState> {
  const session = await requireEboard();
  const eventId = String(formData.get("eventId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const note = String(formData.get("note") ?? "").trim();

  if (!eventId || !email || !note) {
    return { error: "Event, member, and a note are all required." };
  }

  try {
    await addManualAttendance({ orgId: session.user.orgId, eventId, email, note, addedBy: session.user.email, source: "manual" });
    revalidatePath("/admin/attendance");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function deleteAttendanceAction(id: string): Promise<{ error: string | null }> {
  const session = await requireEboard();
  try {
    await deleteAttendance(session.user.orgId, id, session.user.email);
    revalidatePath("/admin/attendance");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

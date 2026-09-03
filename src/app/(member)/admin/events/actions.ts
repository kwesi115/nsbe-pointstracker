"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { clearEventCodeLock } from "@/lib/rate-limit";
import {
  awardGameBonus,
  cancelEvent,
  closeEventNow,
  copyFormFields,
  createEvent,
  extendEvent,
  logSystemAdminEvent,
  openEventNow,
  reopenEvent,
  saveFormFields,
  updateEvent,
  type FormFieldInput,
} from "@/lib/repo";
import { requireEboard } from "@/lib/session";
import type { Audience } from "@/lib/types";

export interface EventFormState {
  error: string | null;
}

function readEventFields(formData: FormData) {
  const pointsRaw = String(formData.get("points") ?? "").trim();
  const durationRaw = String(formData.get("durationMinutes") ?? "").trim();
  const groupIdRaw = String(formData.get("groupId") ?? "").trim();
  return {
    name: String(formData.get("name") ?? "").trim(),
    categoryId: String(formData.get("categoryId") ?? "").trim(),
    groupId: groupIdRaw === "" ? null : groupIdRaw,
    slug: String(formData.get("slug") ?? "").trim(),
    date: formData.get("date") ? new Date(String(formData.get("date"))) : null,
    location: String(formData.get("location") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim(),
    points: pointsRaw === "" ? null : Number(pointsRaw),
    durationMinutes: durationRaw === "" ? null : Number(durationRaw),
    audience: String(formData.get("audience") ?? "all") as Audience,
  };
}

export async function createEventAction(_prevState: EventFormState, formData: FormData): Promise<EventFormState> {
  const session = await requireEboard();
  const fields = readEventFields(formData);
  if (!fields.name || !fields.categoryId) {
    return { error: "Name and category are required." };
  }

  let eventId: string;
  try {
    const event = await createEvent({ orgId: session.user.orgId, ...fields, createdBy: session.user.email });
    eventId = event.eventId;
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin");
  redirect(`/admin/events/${eventId}/questions`);
}

export async function updateEventAction(
  eventId: string,
  _prevState: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const session = await requireEboard();
  const fields = readEventFields(formData);
  if (!fields.name || !fields.categoryId) {
    return { error: "Name and category are required." };
  }

  try {
    await updateEvent({ orgId: session.user.orgId, eventId, ...fields, actor: session.user.email });
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }

  revalidatePath("/admin");
  redirect("/admin");
}

export interface ActionResult {
  error: string | null;
}

export async function openEventAction(eventId: string, durationMinutes: number): Promise<ActionResult> {
  const session = await requireEboard();
  try {
    await openEventNow({ orgId: session.user.orgId, eventId, openedBy: session.user.email, durationMinutes });
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function extendEventAction(eventId: string, extraMinutes = 10): Promise<ActionResult> {
  const session = await requireEboard();
  try {
    await extendEvent({ orgId: session.user.orgId, eventId, extraMinutes, actor: session.user.email });
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function closeEventAction(eventId: string): Promise<ActionResult> {
  const session = await requireEboard();
  try {
    await closeEventNow({ orgId: session.user.orgId, eventId, actor: session.user.email });
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function cancelEventAction(eventId: string): Promise<ActionResult> {
  const session = await requireEboard();
  try {
    await cancelEvent(session.user.orgId, eventId, session.user.email);
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function reopenEventAction(eventId: string, durationMinutes: number): Promise<ActionResult> {
  const session = await requireEboard();
  try {
    await reopenEvent({ orgId: session.user.orgId, eventId, reopenedBy: session.user.email, durationMinutes });
    revalidatePath("/admin");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export interface SaveFormResult {
  error: string | null;
  fields?: FormFieldInput[];
}

export async function saveFormAction(eventId: string, fields: FormFieldInput[]): Promise<SaveFormResult> {
  const session = await requireEboard();
  try {
    const saved = await saveFormFields({ orgId: session.user.orgId, eventId, fields, actor: session.user.email });
    revalidatePath(`/admin/events/${eventId}/questions`);
    return { error: null, fields: saved };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export interface AwardGameBonusResult {
  error: string | null;
  awarded: string[];
  skipped: string[];
}

/** +1 per member per event, capped by PointAward's own unique constraint — see lib/repo.ts awardGameBonus. Only registrants for the event should be offered as choices by the caller. */
export async function awardGameBonusAction(
  eventId: string,
  emails: string[],
  points: number,
  reason: string,
): Promise<AwardGameBonusResult> {
  const session = await requireEboard();
  try {
    const result = await awardGameBonus(session.user.orgId, eventId, emails, points, reason, session.user.email);
    revalidatePath(`/admin/events/${eventId}/responses`);
    revalidatePath("/admin/awards");
    return { error: null, ...result };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, awarded: [], skipped: [] };
    throw err;
  }
}

/** The escape hatch for a per-event check-in code brute-force lock (see lib/rate-limit.ts) — a legitimate room full of people fat-fingering the code shouldn't have to wait out the full 5 minutes. */
export async function clearEventCodeLockAction(eventId: string): Promise<ActionResult> {
  const session = await requireEboard();
  clearEventCodeLock(eventId);
  await logSystemAdminEvent(session.user.orgId, {
    actor: session.user.email,
    action: "code_brute_force_lock_cleared",
    target: eventId,
  });
  revalidatePath("/admin");
  return { error: null };
}

export async function copyFormAction(eventId: string, fromEventId: string): Promise<SaveFormResult> {
  const session = await requireEboard();
  try {
    const copied = await copyFormFields(session.user.orgId, fromEventId, eventId, session.user.email);
    revalidatePath(`/admin/events/${eventId}/questions`);
    return { error: null, fields: copied };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { requirePermission } from "@/lib/permissions";
import {
  addManualAttendanceBulk,
  getAddableMembers,
  getEventAttendees,
  previewManualAttendance,
  previewRemoveRegistration,
  removeRegistration,
  updateRegistrationPoints,
  type AddableMember,
  type AttendeePage,
  type BulkManualAddResult,
  type ManualAddPreview,
  type RemoveRegistrationImpact,
} from "@/lib/repo";
import { requireEboard } from "@/lib/session";

/**
 * Every mutating action here goes through requirePermission("attendance_write")
 * — NOT requireEboard. Adding a member to a closed event, re-pointing a
 * registration, and removing one all award or withdraw points after the
 * check-in window shut, so they are held outright only by ADMIN or by an
 * officer explicitly granted the capability (see lib/access.ts
 * PERMISSION_ROLES). Reading the directory stays plain E-Board access, which
 * is what makes "read-only attendance" a real state rather than a promise.
 */

export interface ActionResult {
  error: string | null;
}

function failed(err: unknown): ActionResult {
  if (err instanceof AppError) return { error: err.message };
  throw err;
}

/** The searchable picker's data source — already excludes anyone registered for this event. */
export async function searchAddableMembersAction(
  eventId: string,
  q: string,
): Promise<{ members: AddableMember[]; error: string | null }> {
  try {
    const session = await requirePermission("attendance_write");
    const members = await getAddableMembers(session.user.orgId, eventId, { q, limit: 25 });
    return { members, error: null };
  } catch (err) {
    if (err instanceof AppError) return { members: [], error: err.message };
    throw err;
  }
}

/** What the add would do, before it happens — points per member, NSBE Week tier moves, and whether the month is still live. */
export async function previewAddAttendeesAction(
  eventId: string,
  emails: string[],
): Promise<{ preview: ManualAddPreview | null; error: string | null }> {
  try {
    const session = await requirePermission("attendance_write");
    const preview = await previewManualAttendance(session.user.orgId, eventId, emails);
    return { preview, error: null };
  } catch (err) {
    if (err instanceof AppError) return { preview: null, error: err.message };
    throw err;
  }
}

export interface AddAttendeesState {
  error: string | null;
  result: BulkManualAddResult | null;
}

/**
 * Dispatched by the Add-attendees dialog's form submit, with the chosen emails
 * as repeated hidden inputs. A repeat submission cannot double-award: the
 * (eventId, userId) unique constraint on Registration turns the second write
 * into `alreadyRegistered`, which the dialog reports as "already added" rather
 * than as a failure.
 */
export async function addAttendeesAction(_prev: AddAttendeesState, formData: FormData): Promise<AddAttendeesState> {
  try {
    const session = await requirePermission("attendance_write");
    const result = await addManualAttendanceBulk({
      orgId: session.user.orgId,
      eventId: String(formData.get("eventId") ?? ""),
      emails: formData.getAll("emails").map((e) => String(e)),
      note: String(formData.get("reason") ?? ""),
      addedBy: session.user.email,
    });
    revalidatePath("/admin/attendance");
    return { result, error: null };
  } catch (err) {
    if (err instanceof AppError) return { result: null, error: err.message };
    throw err;
  }
}

/** What this member loses if the registration goes — shown in the confirmation. */
export async function previewRemoveAction(
  registrationId: string,
): Promise<{ impact: RemoveRegistrationImpact | null; error: string | null }> {
  try {
    const session = await requirePermission("attendance_write");
    const impact = await previewRemoveRegistration(session.user.orgId, registrationId);
    return { impact, error: null };
  } catch (err) {
    if (err instanceof AppError) return { impact: null, error: err.message };
    throw err;
  }
}

export async function removeRegistrationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  try {
    const session = await requirePermission("attendance_write");
    const registrationId = String(formData.get("registrationId") ?? "");
    const reason = String(formData.get("reason") ?? "");
    await removeRegistration(session.user.orgId, registrationId, reason, session.user.email);
    revalidatePath("/admin/attendance");
    return { error: null };
  } catch (err) {
    return failed(err);
  }
}

/** Carries the value that was actually written back, so the table can update the row it already has without re-fetching the page. */
export interface UpdatePointsState {
  error: string | null;
  points: number | null;
}

export async function updateRegistrationPointsAction(
  _prev: UpdatePointsState,
  formData: FormData,
): Promise<UpdatePointsState> {
  try {
    const session = await requirePermission("attendance_write");
    const registrationId = String(formData.get("registrationId") ?? "");
    const reason = String(formData.get("reason") ?? "");
    const points = Number(formData.get("points"));
    if (!Number.isFinite(points) || points < 0) {
      return { error: "Points must be a number, zero or more.", points: null };
    }
    await updateRegistrationPoints(session.user.orgId, registrationId, points, reason, session.user.email);
    revalidatePath("/admin/attendance");
    return { error: null, points };
  } catch (err) {
    return { ...failed(err), points: null };
  }
}

/**
 * The next page of attendees, for "Show more" and for searching within an
 * event. Read-only, so plain E-Board access — an officer without
 * attendance_write can still page and search the directory.
 */
export async function loadAttendeesAction(
  eventId: string,
  cursor: string | null,
  q: string,
): Promise<{ page: AttendeePage | null; error: string | null }> {
  try {
    const session = await requireEboard();
    const page = await getEventAttendees(session.user.orgId, eventId, { cursor, q });
    return { page, error: null };
  } catch (err) {
    if (err instanceof AppError) return { page: null, error: err.message };
    throw err;
  }
}

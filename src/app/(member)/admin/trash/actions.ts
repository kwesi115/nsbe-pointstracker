"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { normalizeEmail } from "@/lib/email";
import {
  emptyTrash,
  previewEmptyTrash,
  previewTrashEvent,
  previewTrashMember,
  purgeTrashedEvent,
  purgeTrashedMember,
  restoreEvent,
  restoreMember,
  runTrashSweep,
  trashEvent,
  trashMember,
  type EmptyTrashPreview,
  type TrashEventPreview,
  type TrashMemberPreview,
} from "@/lib/repo";
import { requireAdmin } from "@/lib/session";

/**
 * The trash bin. ADMIN only, every action — moving an event to the trash takes
 * points off everyone who attended it, and moving a member there signs them
 * out, so neither is ordinary E-Board work. Each mutation below is a
 * `(prevState, formData)` action dispatched by ConfirmDialog's form submit.
 */

export interface TrashActionState {
  error: string | null;
  /** A follow-up the admin must act on — e.g. "Recalculate September after restoring". */
  warning?: string | null;
  /** Human summary of what a permanent deletion removed, for the toast. */
  summary?: string;
}

function failed(err: unknown): TrashActionState {
  if (err instanceof AppError) return { error: err.message };
  throw err;
}

/** Everything the trash pages can change, plus the pages that stop (or start) showing the item. */
function revalidateEverywhere(): void {
  revalidatePath("/admin", "layout");
  revalidatePath("/dashboard");
  revalidatePath("/leaderboard");
  revalidatePath("/events");
}

export async function previewTrashMemberAction(email: string): Promise<{ preview: TrashMemberPreview | null; error: string | null }> {
  try {
    const session = await requireAdmin();
    return { preview: await previewTrashMember(session.user.orgId, normalizeEmail(email), session.user.email), error: null };
  } catch (err) {
    if (err instanceof AppError) return { preview: null, error: err.message };
    throw err;
  }
}

export async function trashMemberAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    await trashMember(
      session.user.orgId,
      normalizeEmail(String(formData.get("email") ?? "")),
      String(formData.get("reason") ?? ""),
      session.user.email,
    );
    revalidateEverywhere();
    return { error: null };
  } catch (err) {
    return failed(err);
  }
}

export async function previewTrashEventAction(eventId: string): Promise<{ preview: TrashEventPreview | null; error: string | null }> {
  try {
    const session = await requireAdmin();
    return { preview: await previewTrashEvent(session.user.orgId, eventId), error: null };
  } catch (err) {
    if (err instanceof AppError) return { preview: null, error: err.message };
    throw err;
  }
}

export async function trashEventAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    await trashEvent(session.user.orgId, String(formData.get("eventId") ?? ""), String(formData.get("reason") ?? ""), session.user.email);
    revalidateEverywhere();
    return { error: null };
  } catch (err) {
    return failed(err);
  }
}

export async function restoreMemberAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    await restoreMember(session.user.orgId, String(formData.get("id") ?? ""), session.user.email);
    revalidateEverywhere();
    return { error: null };
  } catch (err) {
    return failed(err);
  }
}

export async function restoreEventAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    const { championWarning } = await restoreEvent(session.user.orgId, String(formData.get("id") ?? ""), session.user.email);
    revalidateEverywhere();
    return { error: null, warning: championWarning };
  } catch (err) {
    return failed(err);
  }
}

function purgeSummary(r: { label: string; registrations: number; awards: number; files: number; blobFailures: string[] }): string {
  const parts = [`${r.registrations} registration(s)`, `${r.awards} award(s)`];
  if (r.files > 0) parts.push(`${r.files} file(s)`);
  const failures = r.blobFailures.length > 0 ? ` — ${r.blobFailures.length} stored file(s) could not be removed; see the admin log` : "";
  return `Permanently deleted ${r.label}: ${parts.join(", ")}${failures}`;
}

/** "Delete now" — `confirm` must be the member's email, checked server-side in purgeTrashedMember. */
export async function purgeMemberAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    const result = await purgeTrashedMember(session.user.orgId, String(formData.get("id") ?? ""), session.user.email, {
      confirm: String(formData.get("confirm") ?? ""),
    });
    revalidatePath("/admin/trash");
    return { error: null, summary: purgeSummary(result) };
  } catch (err) {
    return failed(err);
  }
}

/** "Delete now" — `confirm` must be the event's name, checked server-side in purgeTrashedEvent. */
export async function purgeEventAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    const result = await purgeTrashedEvent(session.user.orgId, String(formData.get("id") ?? ""), session.user.email, {
      confirm: String(formData.get("confirm") ?? ""),
    });
    revalidatePath("/admin/trash");
    return { error: null, summary: purgeSummary(result) };
  } catch (err) {
    return failed(err);
  }
}

export async function previewEmptyTrashAction(): Promise<{ preview: EmptyTrashPreview | null; error: string | null }> {
  try {
    const session = await requireAdmin();
    return { preview: await previewEmptyTrash(session.user.orgId), error: null };
  } catch (err) {
    if (err instanceof AppError) return { preview: null, error: err.message };
    throw err;
  }
}

/** `confirm` must be exactly "DELETE", checked server-side in emptyTrash. */
export async function emptyTrashAction(_prev: TrashActionState, formData: FormData): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    const result = await emptyTrash(session.user.orgId, session.user.email, String(formData.get("confirm") ?? ""));
    revalidatePath("/admin/trash");
    const failures = result.failures.length > 0 ? `; ${result.failures.length} failed and are still in the trash` : "";
    return { error: null, summary: `Permanently deleted ${result.purged.length} item(s)${failures}` };
  } catch (err) {
    return failed(err);
  }
}

/** "Run cleanup now" — the lazy sweep, forced past its hourly limit (never past the backup check). Dispatched by ActionButton, whose (prevState, formData) it has no use for. */
export async function runCleanupAction(): Promise<TrashActionState> {
  try {
    const session = await requireAdmin();
    const result = await runTrashSweep(session.user.orgId, { force: true, actor: session.user.email });
    revalidatePath("/admin/trash");
    if (!result.ran) {
      return result.reason === "backup_unconfigured"
        ? { error: `Retention paused — backup storage not configured (${result.detail}). Nothing was deleted.` }
        : { error: null, summary: "Cleanup already ran in the last hour." };
    }
    return {
      error: null,
      summary:
        result.purged.length === 0
          ? "Nothing in the trash is past its date."
          : `Permanently deleted ${result.purged.length} expired item(s)${result.failures.length > 0 ? `; ${result.failures.length} failed` : ""}.`,
    };
  } catch (err) {
    return failed(err);
  }
}

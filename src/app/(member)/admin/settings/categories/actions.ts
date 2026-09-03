"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { writeSeasonSnapshot } from "@/lib/export/snapshot";
import { createEventCategory, logSystemAdminEvent, updateEventCategory, type EventCategoryInput } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";
import type { Audience } from "@/lib/types";

export interface CategoryActionState {
  error: string | null;
  fieldErrors?: Record<string, string>;
}

function readCategoryFields(formData: FormData): EventCategoryInput {
  const tierRaw = String(formData.get("tier") ?? "").trim();
  return {
    code: String(formData.get("code") ?? "").trim().toUpperCase().replace(/\s+/g, "_"),
    name: String(formData.get("name") ?? "").trim(),
    shortName: String(formData.get("shortName") ?? "").trim(),
    tier: tierRaw === "" ? null : Number(tierRaw),
    memberPoints: Number(formData.get("memberPoints") ?? 0),
    examples: String(formData.get("examples") ?? "").trim(),
    countsForMonthly: formData.get("countsForMonthly") === "on",
    eboardEligible: formData.get("eboardEligible") === "on",
    audience: String(formData.get("audience") ?? "all") as Audience,
    active: formData.get("active") === "on",
    sortOrder: Number(formData.get("sortOrder") ?? 0),
  };
}

export async function createCategoryAction(_prevState: CategoryActionState, formData: FormData): Promise<CategoryActionState> {
  const session = await requireAdmin();
  const fields = readCategoryFields(formData);
  if (!fields.code || !fields.name || !fields.shortName) {
    return { error: "Code, name, and short name are required." };
  }
  try {
    await createEventCategory(session.user.orgId, fields, session.user.email);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, fieldErrors: err.fieldErrors };
    throw err;
  }
  revalidatePath("/admin/settings/categories");
  return { error: null };
}

export async function updateCategoryAction(
  id: string,
  _prevState: CategoryActionState,
  formData: FormData,
): Promise<CategoryActionState> {
  const session = await requireAdmin();
  const fields = readCategoryFields(formData);
  if (!fields.code || !fields.name || !fields.shortName) {
    return { error: "Code, name, and short name are required." };
  }
  // A point-value edit changes every past registration's DERIVED total with
  // no backfill (see lib/points.ts memberPointsFor) — fire the season
  // snapshot before the write, not blocking on it (a slow snapshot
  // shouldn't hang a settings save; the nightly pg_dump is still the real
  // backup, this is the extra safety net).
  void writeSeasonSnapshot(session.user.orgId)
    .then((result) =>
      logSystemAdminEvent(session.user.orgId, {
        actor: session.user.email,
        action: "create_season_snapshot",
        target: result.key,
        detail: `${result.bytes} bytes — before category point-value edit (${id})`,
      }),
    )
    .catch(() => {});
  try {
    await updateEventCategory(session.user.orgId, id, fields, session.user.email);
  } catch (err) {
    if (err instanceof AppError) return { error: err.message, fieldErrors: err.fieldErrors };
    throw err;
  }
  revalidatePath("/admin/settings/categories");
  revalidatePath("/admin/exports");
  return { error: null };
}

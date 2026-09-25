"use server";

import { RESUME_BUNDLE_ACCESS } from "@/lib/access";
import { requireAccess } from "@/lib/access-guards";
import { AppError } from "@/lib/errors";
import { checkBundleLimits } from "@/lib/export/resume-bundle";
import {
  createResumeBundleRequest,
  getResumeBundleRows,
  isDuplicateRequest,
  type ResumeBundleSelection,
  type ResumeFilters,
} from "@/lib/repo";
import type { Classification } from "@/lib/types";

/**
 * The half of a bulk resume download that happens before a single byte moves:
 * authorize it, resolve exactly which resumes it covers, refuse it if it is
 * empty or oversized, RECORD it, and hand back a ticket.
 *
 * Split from the streaming route on purpose. A Server Action cannot return a
 * file, and a route handler cannot be driven by ConfirmDialog (which owns the
 * pending state and the double-submit guard by submitting a form React
 * controls — see ui/ConfirmDialog.tsx). So the dialog runs this, and the route
 * is reduced to "stream what this ticket already authorized and logged".
 *
 * The consequence worth stating plainly: the AdminLog entry is written here,
 * BEFORE the download starts, and it is written even if the download then
 * fails or the admin cancels it. That is the direction to err in. The log
 * answers "who asked for whose resumes, with what filters" — a question that
 * matters whether or not the bytes arrived — and an entry written after a
 * successful stream would be missing for every download that was interrupted
 * halfway, which is exactly the case someone would later want to ask about.
 */
export interface ResumeBundleState {
  error: string | null;
  /** Present on success — POST it to /api/admin/export/resumes to get the zip. */
  ticket?: string;
  /** How many resumes the bundle will hold, for the progress notice. */
  count?: number;
}

const VALID_CLASSIFICATIONS: Classification[] = ["freshman", "sophomore", "junior", "senior", "graduate"];

/**
 * The filters come back through the form as strings, and are re-validated here
 * rather than trusted: this is the object that decides which members' personal
 * documents get bundled, and it is also the object that gets written to the
 * AdminLog, so an unrecognized value must become "all" (a wider, honestly
 * described bundle) and never a silent narrowing that the log then misreports.
 */
function filtersFromForm(formData: FormData): ResumeFilters {
  const str = (key: string) => String(formData.get(key) ?? "").trim();
  const classification = str("classification");
  const eligible = str("eligible");
  return {
    q: str("q"),
    classification: VALID_CLASSIFICATIONS.includes(classification as Classification)
      ? (classification as Classification)
      : "all",
    major: str("major") || "all",
    house: str("house") || "all",
    eligible: eligible === "yes" || eligible === "no" ? eligible : "all",
  };
}

function selectionFromForm(formData: FormData): ResumeBundleSelection {
  if (String(formData.get("scope")) === "selected") {
    const ids = String(formData.get("memberIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { kind: "selected", memberIds: ids };
  }
  return { kind: "all", filters: filtersFromForm(formData) };
}

export async function prepareResumeBundleAction(
  _prev: ResumeBundleState,
  formData: FormData,
): Promise<ResumeBundleState> {
  try {
    const session = await requireAccess(RESUME_BUNDLE_ACCESS);
    const requestToken = String(formData.get("requestToken") ?? "");
    if (!requestToken) return { error: "Something went wrong. Close this and try again." };

    const selection = selectionFromForm(formData);
    if (selection.kind === "selected" && selection.memberIds.length === 0) {
      return { error: "Nothing is selected. Pick at least one member, or use Download all." };
    }

    const rows = await getResumeBundleRows(session.user.orgId, selection);
    if (rows.length === 0) {
      return {
        error:
          selection.kind === "selected"
            ? "None of the selected members have a resume with consent on file. Nothing to download."
            : "No resumes with consent on file match these filters. Nothing to download.",
      };
    }

    // Checked before the log entry, so a refused bundle leaves no record of a
    // download that never happened.
    const limits = checkBundleLimits(rows);
    if (!limits.ok) return { error: limits.message ?? "That bundle is too large." };

    const ticket = await createResumeBundleRequest(session.user.orgId, {
      actor: session.user.email,
      requestToken,
      selection,
      count: rows.length,
    });

    return { error: null, ticket: requestToken, count: ticket.count };
  } catch (err) {
    // A repeat submission of the SAME confirmation — the token was already
    // claimed. The first one logged it and is already downloading; saying so
    // is better than a second zip and a second log entry for one intent.
    if (isDuplicateRequest(err)) {
      return { error: "That download is already running. Check your browser's downloads." };
    }
    if (err instanceof AppError) return { error: err.message };
    console.error(err);
    return { error: "Something went wrong preparing the download. Try again." };
  }
}

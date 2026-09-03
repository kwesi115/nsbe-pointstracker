"use server";

import { revalidatePath } from "next/cache";
import { AppError } from "@/lib/errors";
import { codeFromName, serializeHouses, type House } from "@/lib/houses";
import { DEFAULT_LEADERBOARD_DISCLAIMER, DEFAULT_NATIONAL_MEMBERSHIP_URL, setConfigValue } from "@/lib/repo";
import { requireAdmin } from "@/lib/session";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Parses the House editor's hidden housesJson field — never trusts the client's code, always regenerates it from name, and drops blank rows and any color that isn't a real hex value. */
function parseHousesFromForm(raw: string): House[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((h): h is { name: unknown; color: unknown } => Boolean(h) && typeof h === "object")
    .filter((h) => typeof h.name === "string" && (h.name as string).trim())
    .map((h) => ({
      name: (h.name as string).trim(),
      code: codeFromName(h.name as string),
      color: typeof h.color === "string" && HEX_COLOR.test(h.color) ? h.color : "#5A6485",
    }));
}

export interface SettingsState {
  error: string | null;
}

export async function updateSettingsAction(_prevState: SettingsState, formData: FormData): Promise<SettingsState> {
  const session = await requireAdmin();
  const orgId = session.user.orgId;
  const season = String(formData.get("season") ?? "").trim();
  const domain = String(formData.get("domain") ?? "").trim().toLowerCase();
  const chapterName = String(formData.get("chapterName") ?? "").trim();
  const defaultEventDurationRaw = Number(formData.get("defaultEventDuration") ?? 15);
  const defaultEventDuration = String(Number.isFinite(defaultEventDurationRaw) && defaultEventDurationRaw > 0 ? defaultEventDurationRaw : 15);
  const leaderboardDisclaimer = String(formData.get("leaderboardDisclaimer") ?? "").trim() || DEFAULT_LEADERBOARD_DISCLAIMER;
  // Login-only exemption from the domain check above (lib/repo.ts
  // isLoginEmailAllowed) — this IS an authentication bypass list, which is
  // exactly why every change here goes through setConfigValue's own
  // AdminLog write, same as every other field on this form.
  const adminEmailAllowlist = String(formData.get("adminEmailAllowlist") ?? "")
    .split("\n")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
    .join("|");

  try {
    await Promise.all([
      setConfigValue(orgId, "SEASON", season, session.user.email),
      setConfigValue(orgId, "ALLOWED_EMAIL_DOMAIN", domain, session.user.email),
      setConfigValue(orgId, "ADMIN_EMAIL_ALLOWLIST", adminEmailAllowlist, session.user.email),
      setConfigValue(orgId, "CHAPTER_NAME", chapterName, session.user.email),
      setConfigValue(orgId, "DEFAULT_EVENT_DURATION", defaultEventDuration, session.user.email),
      setConfigValue(orgId, "LEADERBOARD_DISCLAIMER", leaderboardDisclaimer, session.user.email),
    ]);
    revalidatePath("/admin/settings");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function updateCoreFormSettingsAction(_prevState: SettingsState, formData: FormData): Promise<SettingsState> {
  const session = await requireAdmin();
  const orgId = session.user.orgId;
  const majorsList = String(formData.get("majorsList") ?? "")
    .split("\n")
    .map((m) => m.trim())
    .filter(Boolean)
    .join("|");
  const houses = parseHousesFromForm(String(formData.get("housesJson") ?? ""));
  const showPendingPoints = formData.get("showPendingPoints") === "on" ? "true" : "false";
  const maxExtraQuestionsRaw = Number(formData.get("maxExtraQuestions") ?? 5);
  // Server-side ceiling is 5 regardless (see repo.saveFormFields) — clamp here too so the field never shows a misleading number.
  const maxExtraQuestions = String(Math.max(0, Math.min(5, Number.isFinite(maxExtraQuestionsRaw) ? maxExtraQuestionsRaw : 5)));

  try {
    await Promise.all([
      setConfigValue(orgId, "MAJORS_LIST", majorsList, session.user.email),
      setConfigValue(orgId, "HOUSES_LIST", serializeHouses(houses), session.user.email),
      setConfigValue(orgId, "SHOW_PENDING_POINTS", showPendingPoints, session.user.email),
      setConfigValue(orgId, "MAX_EXTRA_QUESTIONS", maxExtraQuestions, session.user.email),
    ]);
    revalidatePath("/admin/settings");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

/** "External links" (Part 2) — the three URLs the core form's descriptions/House block reference, grouped together so an admin can see and update them in one place. */
export async function updateExternalLinksAction(_prevState: SettingsState, formData: FormData): Promise<SettingsState> {
  const session = await requireAdmin();
  const orgId = session.user.orgId;
  const houseTestUrl = String(formData.get("houseTestUrl") ?? "").trim();
  const membershipSiteUrl = String(formData.get("membershipSiteUrl") ?? "").trim();
  const nationalMembershipUrl = String(formData.get("nationalMembershipUrl") ?? "").trim() || DEFAULT_NATIONAL_MEMBERSHIP_URL;

  try {
    await Promise.all([
      setConfigValue(orgId, "HOUSE_TEST_URL", houseTestUrl, session.user.email),
      setConfigValue(orgId, "MEMBERSHIP_SITE_URL", membershipSiteUrl, session.user.email),
      setConfigValue(orgId, "NATIONAL_MEMBERSHIP_URL", nationalMembershipUrl, session.user.email),
    ]);
    revalidatePath("/admin/settings");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

export async function updateEboardSettingsAction(_prevState: SettingsState, formData: FormData): Promise<SettingsState> {
  const session = await requireAdmin();
  const orgId = session.user.orgId;
  const pointValueRaw = Number(formData.get("eboardPointValue") ?? 1);
  const pointValue = String(Number.isFinite(pointValueRaw) ? pointValueRaw : 1);
  const trackEnabled = formData.get("eboardTrackEnabled") === "on" ? "true" : "false";
  const requiresMembership = formData.get("eboardRequiresMembership") === "on" ? "true" : "false";

  try {
    await Promise.all([
      setConfigValue(orgId, "EBOARD_POINT_VALUE", pointValue, session.user.email),
      setConfigValue(orgId, "EBOARD_TRACK_ENABLED", trackEnabled, session.user.email),
      setConfigValue(orgId, "EBOARD_REQUIRES_MEMBERSHIP", requiresMembership, session.user.email),
    ]);
    revalidatePath("/admin/settings");
    return { error: null };
  } catch (err) {
    if (err instanceof AppError) return { error: err.message };
    throw err;
  }
}

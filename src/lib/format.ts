/**
 * Shared display formatting — dates always rendered in America/New_York
 * (the chapter's timezone, matching how they're stored), regardless of the
 * viewer's browser timezone. Safe for both server and client components.
 */

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { CLASSIFICATION_OPTIONS, OTHER_MAJOR } from "./core-form";
import type { Classification } from "./types";

const TIME_ZONE = "America/New_York";

function tz(d: Date): TZDate {
  return TZDate.tz(TIME_ZONE, d.getTime());
}

export function formatDate(d: Date | null): string {
  if (!d) return "—";
  return format(tz(d), "MMM d, yyyy");
}

export function formatDateTime(d: Date | null): string {
  if (!d) return "—";
  return format(tz(d), "MMM d, yyyy 'at' h:mm a");
}

/** mm:ss for under an hour, h:mm:ss beyond that — used by countdowns. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

/** "2026-09" -> "September 2026" — a Monthly Engagement Champion period in words. Anything malformed is returned as-is. */
export function formatMonthKey(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return format(new Date(Number(match[1]), Number(match[2]) - 1, 1), "MMMM yyyy");
}

/** An explicit sign on anything non-zero — "+3", "-3", "0" — for a point change, where a bare "3" reads as a total. */
export function formatSigned(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

/** Falls back to the email's local part (never the raw email or a manufactured name) when a member has no first/last name on file. */
export function memberDisplayName(firstName: string, lastName: string, email: string): string {
  const full = `${firstName} ${lastName}`.trim();
  return full || email.split("@")[0];
}

/**
 * A Classification for display: "junior" -> "Junior", "graduate" -> "Graduate
 * Student".
 *
 * THE ONE formatter for this value. The stored enum is lowercase (see
 * prisma/schema.prisma Classification) and several surfaces used to render it
 * raw, so the roster showed "junior" while the dropdown that set it showed
 * "Junior". Labels come from lib/core-form.ts CLASSIFICATION_OPTIONS — the same
 * array every picker renders — so a label can never drift between the control
 * that writes a value and the table that reads it back.
 *
 * Display layer only: nothing here rewrites what is stored.
 */
export function formatClassification(value: Classification | "" | null | undefined): string {
  if (!value) return "";
  return CLASSIFICATION_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

/**
 * A major for display: the stored value, unless it is the "Other" sentinel, in
 * which case the free-text answer the member actually typed.
 *
 * Same reasoning as formatClassification above — the pair (major, majorOther)
 * is only ever meaningful together, and every surface that rendered `major`
 * raw showed a literal "Other" where a major belonged.
 */
export function formatMajor(major: string, majorOther: string): string {
  return (major === OTHER_MAJOR ? majorOther : major) || "";
}

/**
 * A file size for a person: "148 KB", "2.4 MB". Decimal units (1000, not
 * 1024) because that is what every operating system's file browser shows, and
 * a resume listed as 2.4 MB here should not read as 2.3 MB after download.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / (1000 * 1000)).toFixed(1)} MB`;
}

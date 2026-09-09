/**
 * Shared display formatting — dates always rendered in America/New_York
 * (the chapter's timezone, matching how they're stored), regardless of the
 * viewer's browser timezone. Safe for both server and client components.
 */

import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

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

export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

/** Falls back to the email's local part (never the raw email or a manufactured name) when a member has no first/last name on file. */
export function memberDisplayName(firstName: string, lastName: string, email: string): string {
  const full = `${firstName} ${lastName}`.trim();
  return full || email.split("@")[0];
}

import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { getEventCodeAlertState } from "@/lib/rate-limit";
import { getEventsWithStats } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

/** Polled by the admin events board every 15s for live registration counts, and (Part 2) each event's check-in code brute-force alert/lock state. */
export const GET = withApiErrors(async () => {
  const session = await requireEboard();
  const events = await getEventsWithStats(session.user.orgId);
  const withAlerts = events.map((e) => ({ ...e, codeAlert: getEventCodeAlertState(e.eventId) }));
  return NextResponse.json({ events: withAlerts, serverNow: new Date().toISOString() });
});

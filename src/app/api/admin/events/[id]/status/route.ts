import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { isOpen } from "@/lib/points";
import { getEventCodeAlertState } from "@/lib/rate-limit";
import { getAttendanceForEvent, getEvent } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

/** Polled by the projector display (/admin/events/[id]/display) every 5s. Never blank the last-known values on the client if this fails — see ProjectorClient. */
export const GET = withApiErrors(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireEboard();
  const { id } = await ctx.params;
  const event = await getEvent(session.user.orgId, id);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  const now = new Date();
  const attendance = await getAttendanceForEvent(session.user.orgId, id);

  return NextResponse.json({
    name: event.name,
    open: isOpen(event, now),
    registrationCount: attendance.length,
    closesAt: event.closesAt,
    codeAlert: getEventCodeAlertState(id),
  });
});

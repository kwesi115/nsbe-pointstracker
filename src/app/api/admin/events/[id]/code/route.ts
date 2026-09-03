import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { currentCode, msUntilRotation } from "@/lib/code";
import { AppError } from "@/lib/errors";
import { isOpen } from "@/lib/points";
import { getEvent } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

/** Polled by the projector display (/admin/events/[id]/display) every 5s. 404s once the window closes — there is no code to show, and the display swaps to "Registration closed" rather than treating a fetch failure as a reconnect. */
export const GET = withApiErrors(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireEboard();
  const { id } = await ctx.params;
  const event = await getEvent(session.user.orgId, id);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");

  const now = new Date();
  if (!isOpen(event, now)) throw new AppError("NOT_FOUND", "This event isn't open — there is no code to show");

  return NextResponse.json({
    code: currentCode(event.eventId, now),
    msUntilRotation: msUntilRotation(now),
  });
});

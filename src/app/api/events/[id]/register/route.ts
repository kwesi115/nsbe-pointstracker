import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { clientIp } from "@/lib/request";
import { registerForEvent } from "@/lib/repo";
import { requireSession } from "@/lib/session";

export const POST = withApiErrors(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  // Captured before any await — see repo.ts's RegisterForEventInput.receivedAt
  // for why: a later timestamp (e.g. taken after the session/body awaits
  // below, or worse, once registerForEvent's write finally reaches the front
  // of the workbook lock) can unfairly fail someone who submitted in time but
  // got queued behind other writes during a rush.
  const receivedAt = new Date();

  const session = await requireSession();
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));

  const result = await registerForEvent({
    orgId: session.user.orgId,
    email: session.user.email,
    eventId: id,
    code: String(body?.code ?? ""),
    core: body?.core ?? {},
    extra: body?.extra ?? {},
    receivedAt,
    ip: clientIp(request),
  });
  return NextResponse.json(result);
});

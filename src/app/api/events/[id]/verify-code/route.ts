import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { verifyCode } from "@/lib/code";
import { AppError } from "@/lib/errors";
import { isOpen } from "@/lib/points";
import {
  assertNotCodeVerifyRateLimited,
  hashIp,
  isEventCodeLocked,
  recordCodeVerifyAttempt,
  recordEventCodeFailure,
} from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getConfigValue, getEvent, getUserId, logSystemAdminEvent } from "@/lib/repo";
import { requireSession } from "@/lib/session";

/**
 * Gates the check-in form's render — does NOT create anything. This is a UX
 * checkpoint, not the security boundary: registerForEvent re-verifies the
 * code from scratch against its own receivedAt, so a stale/replayed pass
 * here can never itself produce a registration.
 */
export const POST = withApiErrors(async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const receivedAt = new Date();
  const session = await requireSession();
  const { id } = await ctx.params;
  const body = await request.json().catch(() => ({}));
  const code = String(body?.code ?? "").trim();

  const userId = await getUserId(session.user.orgId, session.user.email);
  if (!userId) throw new AppError("UNAUTHENTICATED", "You must be signed in");

  // Per-member/IP limiter — checked first (cheapest, most common rejection),
  // recorded only below on an actual bad code, never on success.
  assertNotCodeVerifyRateLimited(userId, id);

  const event = await getEvent(session.user.orgId, id);
  if (!event) throw new AppError("NOT_FOUND", "Event not found");
  if (!isOpen(event, receivedAt)) {
    throw new AppError("EVENT_NOT_OPEN", "This event isn't open for check-in right now");
  }

  // Per-EVENT brute-force lock — same EVENT_NOT_OPEN-shaped message a
  // genuinely closed event gives, so an attacker can't tell "closed" from
  // "locked" apart (see lib/rate-limit.ts).
  if (isEventCodeLocked(event.eventId, receivedAt.getTime())) {
    throw new AppError("EVENT_NOT_OPEN", "Check-in is temporarily paused — see an E-Board member");
  }

  if (!verifyCode(event.eventId, code, receivedAt)) {
    recordCodeVerifyAttempt(userId, id);
    console.warn(
      JSON.stringify({ event: "code_verify_failed", orgId: session.user.orgId, eventId: event.eventId, who: userId, ipHash: hashIp(clientIp(request)) }),
    );
    const [softRaw, hardRaw] = await Promise.all([
      getConfigValue(session.user.orgId, "EVENT_CODE_FAIL_SOFT", "100"),
      getConfigValue(session.user.orgId, "EVENT_CODE_FAIL_HARD", "250"),
    ]);
    const { crossedSoft } = recordEventCodeFailure(event.eventId, Number(softRaw) || 100, Number(hardRaw) || 250, receivedAt.getTime());
    if (crossedSoft) {
      await logSystemAdminEvent(session.user.orgId, {
        actor: "system",
        action: "code_brute_force_suspected",
        target: event.eventId,
        detail: "Failed check-in code attempts crossed the alert threshold",
      });
    }
    throw new AppError("BAD_CODE", "That code isn't right. Check the display and try again.");
  }

  return NextResponse.json({ ok: true });
});

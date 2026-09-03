"use server";

import { verifyCode } from "@/lib/code";
import { AppError } from "@/lib/errors";
import { requireGuestPass } from "@/lib/guest-pass";
import { isOpen } from "@/lib/points";
import {
  assertNotCodeVerifyRateLimited,
  hashIp,
  isEventCodeLocked,
  recordCodeVerifyAttempt,
  recordEventCodeFailure,
} from "@/lib/rate-limit";
import { clientIpFromHeaders } from "@/lib/request";
import { getConfigValue, getEvent, logSystemAdminEvent, registerGuest } from "@/lib/repo";
import type { FormAnswers } from "@/lib/forms";

export interface GuestRegisterState {
  error: string | null;
  fieldErrors?: Record<string, string>;
  success: boolean;
  /**
   * The AppError code, when the failure was BAD_CODE or EVENT_NOT_OPEN — lets
   * the client bounce back to the code gate precisely, instead of guessing
   * from the error message text.
   */
  errorCode?: string;
}

export interface GuestRegisterInput {
  eventId: string;
  code: string;
  firstName: string;
  lastName: string;
  email: string;
  affiliation: string;
  phone: string;
  extra: FormAnswers;
}

export interface VerifyGuestCodeState {
  ok: boolean;
  error: string | null;
  eventNotOpen?: boolean;
}

/**
 * Guests have no account to key a member-style rate limit by — same
 * reasoning as the rest of the guest surface (see rate-limit.ts's guest
 * check-in limiter), so this is keyed by IP instead. Gates the guest form's
 * render only; registerGuest() re-verifies independently below.
 */
export async function verifyGuestEventCodeAction(eventId: string, code: string): Promise<VerifyGuestCodeState> {
  const { orgId } = await requireGuestPass();
  const ip = await clientIpFromHeaders();
  const now = new Date();

  try {
    assertNotCodeVerifyRateLimited(ip, eventId, now.getTime());
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.message };
    throw err;
  }

  const event = await getEvent(orgId, eventId);
  if (!event) return { ok: false, error: "Event not found" };
  if (!isOpen(event, now)) {
    return { ok: false, error: "This event isn't open for check-in right now", eventNotOpen: true };
  }

  // Per-EVENT brute-force lock — same EVENT_NOT_OPEN-shaped message a
  // genuinely closed event gives (see lib/rate-limit.ts).
  if (isEventCodeLocked(event.eventId, now.getTime())) {
    return { ok: false, error: "Check-in is temporarily paused — see an E-Board member", eventNotOpen: true };
  }

  if (!verifyCode(event.eventId, code, now)) {
    recordCodeVerifyAttempt(ip, eventId, now.getTime());
    console.warn(
      JSON.stringify({ event: "code_verify_failed", orgId, eventId: event.eventId, who: `guest:${ip}`, ipHash: hashIp(ip) }),
    );
    const [softRaw, hardRaw] = await Promise.all([
      getConfigValue(orgId, "EVENT_CODE_FAIL_SOFT", "100"),
      getConfigValue(orgId, "EVENT_CODE_FAIL_HARD", "250"),
    ]);
    const { crossedSoft } = recordEventCodeFailure(event.eventId, Number(softRaw) || 100, Number(hardRaw) || 250, now.getTime());
    if (crossedSoft) {
      await logSystemAdminEvent(orgId, {
        actor: "system",
        action: "code_brute_force_suspected",
        target: event.eventId,
        detail: "Failed check-in code attempts crossed the alert threshold",
      });
    }
    return { ok: false, error: "That code isn't right. Check the display and try again." };
  }
  return { ok: true, error: null };
}

/**
 * The entire point of a separate route (Part 5): first/last name, email (any
 * domain — no domain check for guests), affiliation, optional phone, plus the
 * event's extra questions. Nothing about dues, national membership,
 * classification, major, House, or resume. registerGuest() upserts a GUEST
 * User with no password (see lib/repo.ts) — the (eventId, userId) unique
 * constraint is what blocks a double check-in. The code gate above only
 * decides whether this form gets shown; registerGuest re-verifies the code
 * itself, against its own receivedAt, before writing anything.
 */
export async function submitGuestRegistrationAction(input: GuestRegisterInput): Promise<GuestRegisterState> {
  const { orgId } = await requireGuestPass();
  const ip = await clientIpFromHeaders();

  try {
    await registerGuest({
      orgId,
      eventId: input.eventId,
      code: input.code,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      affiliation: input.affiliation,
      phone: input.phone || undefined,
      extra: input.extra,
      ip,
    });
    return { error: null, success: true };
  } catch (err) {
    if (err instanceof AppError) {
      return { error: err.message, fieldErrors: err.fieldErrors, success: false, errorCode: err.code };
    }
    throw err;
  }
}

/**
 * Rotating check-in codes. Never stored — derived on demand from CODE_SECRET,
 * the event id, and the current 60-second step, so there's nothing in the
 * database to leak, rotate, or clean up. A code exists only while the event
 * is open (see lib/points.ts isOpen); this module has no idea what "open"
 * means, it just computes what the digits would be for a given instant.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const ROTATION_MS = 60_000;
const CODE_DIGITS = 6;
const CODE_MODULUS = 10 ** CODE_DIGITS;

function secret(): string {
  const value = process.env.CODE_SECRET;
  if (!value) throw new Error("CODE_SECRET is not set");
  return value;
}

function stepFor(now: Date): number {
  return Math.floor(now.getTime() / ROTATION_MS);
}

function codeForStep(eventId: string, step: number): string {
  const digest = createHmac("sha256", secret()).update(`${eventId}:${step}`).digest();
  const num = digest.readUInt32BE(0) % CODE_MODULUS;
  return String(num).padStart(CODE_DIGITS, "0");
}

/** The code for `eventId` right now. Callers must gate this on isOpen(event, now) themselves — this function has no concept of open/closed. */
export function currentCode(eventId: string, now: Date): string {
  return codeForStep(eventId, stepFor(now));
}

/** Milliseconds until the code next rotates. */
export function msUntilRotation(now: Date): number {
  return ROTATION_MS - (now.getTime() % ROTATION_MS);
}

/**
 * Accepts the current 60-second step's code OR the immediately previous
 * step's — someone who started typing just before a rotation must not be
 * rejected by the time they hit submit, and phone clocks drift. Anything
 * else (including a malformed submission) is rejected. Comparison against
 * each candidate is constant-time; the shape/length check ahead of it is not
 * a timing concern (it never distinguishes among valid-looking codes).
 */
export function verifyCode(eventId: string, submitted: string, now: Date): boolean {
  if (!/^\d{6}$/.test(submitted)) return false;
  const submittedBuf = Buffer.from(submitted, "utf8");
  const step = stepFor(now);
  return [step, step - 1].some((s) => {
    const candidate = Buffer.from(codeForStep(eventId, s), "utf8");
    return timingSafeEqual(candidate, submittedBuf);
  });
}

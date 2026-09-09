/**
 * In-process fixed-window brute-force limiters. We're single-instance, so an
 * in-memory map is the whole defense — no Microsoft in front of us anymore to
 * absorb credential stuffing.
 *
 * If this ever runs on more than one instance, every Map in this file (and
 * the event-code lock state below) needs to move to a shared store (Redis /
 * Upstash) — an in-memory counter per instance means an attacker gets N
 * instances' worth of free attempts before any one of them trips a limit.
 */

import { createHash } from "node:crypto";
import { normalizeEmail } from "./email";
import { AppError } from "./errors";

export const WINDOW_MS = 15 * 60_000;
export const EMAIL_ATTEMPT_LIMIT = 5;
export const IP_ATTEMPT_LIMIT = 20;

interface Window {
  count: number;
  windowStart: number;
}

const emailAttempts = new Map<string, Window>();
const ipAttempts = new Map<string, Window>();

function activeWindow(store: Map<string, Window>, key: string, now: number, windowMs: number): Window | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (now - entry.windowStart >= windowMs) {
    store.delete(key);
    return null;
  }
  return entry;
}

function minutesRemaining(entry: Window, now: number, windowMs: number): number {
  const remainingMs = windowMs - (now - entry.windowStart);
  return Math.max(1, Math.ceil(remainingMs / 60_000));
}

function assertUnderLimit(
  store: Map<string, Window>,
  key: string,
  limit: number,
  windowMs: number,
  now: number,
  message: string,
): void {
  const entry = activeWindow(store, key, now, windowMs);
  if (entry && entry.count >= limit) {
    throw new AppError(
      "TOO_MANY_ATTEMPTS",
      `${message} Try again in ${minutesRemaining(entry, now, windowMs)} minute(s).`,
    );
  }
}

function bump(store: Map<string, Window>, key: string, now: number, windowMs: number): void {
  const entry = activeWindow(store, key, now, windowMs);
  if (entry) {
    entry.count += 1;
  } else {
    store.set(key, { count: 1, windowStart: now });
  }
}

/** Throws TOO_MANY_ATTEMPTS if either the email or the IP is currently over its limit. */
export function assertNotRateLimited(email: string, ip: string, now: number = Date.now()): void {
  assertUnderLimit(
    emailAttempts,
    normalizeEmail(email),
    EMAIL_ATTEMPT_LIMIT,
    WINDOW_MS,
    now,
    "Too many failed attempts.",
  );
  assertUnderLimit(ipAttempts, ip, IP_ATTEMPT_LIMIT, WINDOW_MS, now, "Too many failed attempts from this network.");
}

export function recordFailedAttempt(email: string, ip: string, now: number = Date.now()): void {
  bump(emailAttempts, normalizeEmail(email), now, WINDOW_MS);
  bump(ipAttempts, ip, now, WINDOW_MS);
}

/** Successful login clears the email counter only — the IP counter persists, since it's guarding against spraying across many accounts from one network. */
export function clearRateLimit(email: string): void {
  emailAttempts.delete(normalizeEmail(email));
}

// ---------------------------------------------------------------------------
// Self-service signup — 3 per IP per hour. Deliberately tight: a signup form
// has no account yet to rate-limit by, so IP is the only key available.
// ---------------------------------------------------------------------------

const signupAttempts = new Map<string, Window>();
export const SIGNUP_WINDOW_MS = 60 * 60_000;
export const SIGNUP_IP_LIMIT = 3;

export function assertNotSignupRateLimited(ip: string, now: number = Date.now()): void {
  assertUnderLimit(signupAttempts, ip, SIGNUP_IP_LIMIT, SIGNUP_WINDOW_MS, now, "Too many signup attempts.");
}

export function recordSignupAttempt(ip: string, now: number = Date.now()): void {
  bump(signupAttempts, ip, now, SIGNUP_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// File uploads — 10 per member per hour. Keyed by userId (unlike signup,
// there's already an authenticated account here, so no need to fall back to IP).
// ---------------------------------------------------------------------------

const uploadAttempts = new Map<string, Window>();
export const UPLOAD_WINDOW_MS = 60 * 60_000;
export const UPLOAD_LIMIT = 10;

export function assertNotUploadRateLimited(userId: string, now: number = Date.now()): void {
  assertUnderLimit(uploadAttempts, userId, UPLOAD_LIMIT, UPLOAD_WINDOW_MS, now, "Too many uploads.");
}

export function recordUploadAttempt(userId: string, now: number = Date.now()): void {
  bump(uploadAttempts, userId, now, UPLOAD_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Join codes — 5 attempts per IP per hour, shared by /join (member signup)
// and /guest/join (guest pass). Deliberately the same limiter for both: a
// join code and a guest code are the same kind of secret, guessed the same
// way. Generic failure message lives with the caller (lib/repo.ts's
// matchJoinCode/redeemJoinCodeForSignup/redeemGuestJoinCode never say why a
// code failed) — this only throttles the attempt rate.
// ---------------------------------------------------------------------------

const joinCodeAttempts = new Map<string, Window>();
export const JOIN_CODE_WINDOW_MS = 60 * 60_000;
export const JOIN_CODE_IP_LIMIT = 5;

export function assertNotJoinCodeRateLimited(ip: string, now: number = Date.now()): void {
  assertUnderLimit(joinCodeAttempts, ip, JOIN_CODE_IP_LIMIT, JOIN_CODE_WINDOW_MS, now, "Too many attempts.");
}

export function recordJoinCodeAttempt(ip: string, now: number = Date.now()): void {
  bump(joinCodeAttempts, ip, now, JOIN_CODE_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Guest check-in — genuinely unauthenticated (see src/proxy.ts), so IP is the
// only key available, same reasoning as signup.
// ---------------------------------------------------------------------------

const guestCheckInAttempts = new Map<string, Window>();
export const GUEST_CHECKIN_WINDOW_MS = 60 * 60_000;
export const GUEST_CHECKIN_IP_LIMIT = 10;

export function assertNotGuestCheckInRateLimited(ip: string, now: number = Date.now()): void {
  assertUnderLimit(
    guestCheckInAttempts,
    ip,
    GUEST_CHECKIN_IP_LIMIT,
    GUEST_CHECKIN_WINDOW_MS,
    now,
    "Too many guest check-ins from this network.",
  );
}

export function recordGuestCheckInAttempt(ip: string, now: number = Date.now()): void {
  bump(guestCheckInAttempts, ip, now, GUEST_CHECKIN_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Check-in code verification — 10 attempts per member per event per 10
// minutes. A 6-digit rotating code is guessable at speed without this; the
// limiter is what makes rotation actually meaningful. Keyed by
// `${who}:${eventId}` where `who` is a userId (member) or an IP (guest —
// no account to key by, same reasoning as signup/guest check-in above).
// ---------------------------------------------------------------------------

const codeVerifyAttempts = new Map<string, Window>();
export const CODE_VERIFY_WINDOW_MS = 10 * 60_000;
export const CODE_VERIFY_LIMIT = 10;

export function assertNotCodeVerifyRateLimited(who: string, eventId: string, now: number = Date.now()): void {
  assertUnderLimit(
    codeVerifyAttempts,
    `${who}:${eventId}`,
    CODE_VERIFY_LIMIT,
    CODE_VERIFY_WINDOW_MS,
    now,
    "Too many code attempts.",
  );
}

export function recordCodeVerifyAttempt(who: string, eventId: string, now: number = Date.now()): void {
  bump(codeVerifyAttempts, `${who}:${eventId}`, now, CODE_VERIFY_WINDOW_MS);
}

// ---------------------------------------------------------------------------
// Per-EVENT check-in code brute force — the limiter above stops one
// persistent guesser; it does nothing against one attacker running the same
// 10-attempts-per-10-minutes allowance across many accounts (or many guest
// IPs) against the same event. This one is keyed by eventId alone, counting
// only FAILED verifications across every member/guest/IP together. At
// EVENT_CODE_FAIL_SOFT it's flagged (admin banner + one AdminLog entry, not
// one per attempt); at EVENT_CODE_FAIL_HARD the event is locked for
// EVENT_CODE_LOCK_MS — every verification attempt during the lock, valid
// code or not, gets the same EVENT_NOT_OPEN-shaped rejection a genuinely
// closed event would give (see callers), so a distributed attacker can't
// tell "closed" from "locked" apart.
// ---------------------------------------------------------------------------

const eventCodeFails = new Map<string, Window>();
export const EVENT_CODE_FAIL_WINDOW_MS = 10 * 60_000;
export const EVENT_CODE_LOCK_MS = 5 * 60_000;

interface EventLock {
  /** null until hard is actually crossed — NOT "now", which isEventCodeLocked would treat as already-expired and immediately discard. */
  lockedUntil: number | null;
  /** Set once soft is crossed, so a caller logs the AdminLog "suspected" entry at most once per window instead of once per subsequent failure. */
  softLoggedAt: number | null;
}
const eventLocks = new Map<string, EventLock>();

export function isEventCodeLocked(eventId: string, now: number = Date.now()): boolean {
  const lock = eventLocks.get(eventId);
  if (!lock || lock.lockedUntil === null) return false;
  if (now >= lock.lockedUntil) {
    // Expired — clear just the lock, not softLoggedAt (getEventCodeAlertState
    // still wants to know a soft crossing happened recently).
    lock.lockedUntil = null;
    return false;
  }
  return true;
}

/** The admin escape hatch (see /admin's "clear lock" action) — a legitimate room full of people fat-fingering the code shouldn't have to wait out the full 5 minutes. */
export function clearEventCodeLock(eventId: string): void {
  eventLocks.delete(eventId);
  eventCodeFails.delete(eventId);
}

export interface RecordEventCodeFailureResult {
  count: number;
  /** True only on the call that just crossed soft for the first time this window — callers should write the AdminLog "suspected" entry exactly when this is true. */
  crossedSoft: boolean;
  /** True only on the call that just crossed hard — callers don't need to do anything further; the lock is already set by the time this returns. */
  crossedHard: boolean;
}

/** Call once per FAILED verification (never on success — see callers). Bumps the per-event counter and, on crossing hard, sets the lock itself. */
export function recordEventCodeFailure(
  eventId: string,
  softLimit: number,
  hardLimit: number,
  now: number = Date.now(),
): RecordEventCodeFailureResult {
  const before = activeWindow(eventCodeFails, eventId, now, EVENT_CODE_FAIL_WINDOW_MS)?.count ?? 0;
  bump(eventCodeFails, eventId, now, EVENT_CODE_FAIL_WINDOW_MS);
  const after = before + 1;

  const crossedSoft = before < softLimit && after >= softLimit;
  const crossedHard = before < hardLimit && after >= hardLimit;
  if (crossedHard) {
    const existing = eventLocks.get(eventId);
    eventLocks.set(eventId, { lockedUntil: now + EVENT_CODE_LOCK_MS, softLoggedAt: existing?.softLoggedAt ?? now });
  } else if (crossedSoft) {
    const existing = eventLocks.get(eventId);
    eventLocks.set(eventId, { lockedUntil: existing?.lockedUntil ?? null, softLoggedAt: now });
  }
  return { count: after, crossedSoft, crossedHard };
}

export interface EventCodeAlertState {
  suspicious: boolean;
  locked: boolean;
  lockedUntil: number | null;
}

/** Polled by /admin and the projector display (see /api/admin/events/[id]/status) to render the "unusual activity" banner and the paused message. */
export function getEventCodeAlertState(eventId: string, now: number = Date.now()): EventCodeAlertState {
  const locked = isEventCodeLocked(eventId, now);
  const lock = eventLocks.get(eventId);
  // eventLocks isn't cleared when the fail window itself rolls over (only on
  // an admin clear or a lock's own expiry) — cross-check against the fail
  // window's own lazy expiry so "suspicious" doesn't stay stuck true forever
  // after a one-time spike ages out.
  const withinFailWindow = activeWindow(eventCodeFails, eventId, now, EVENT_CODE_FAIL_WINDOW_MS) !== null;
  const suspicious = locked || (lock?.softLoggedAt != null && withinFailWindow);
  return {
    suspicious,
    locked,
    lockedUntil: locked ? (lock?.lockedUntil ?? null) : null,
  };
}

/**
 * Truncated, salted IP hash for the failed-verification log line below —
 * enough to correlate repeated attempts from the same network during an
 * investigation, not enough to be a reversible tracking database. Salted
 * with CODE_SECRET (already required for the app to run at all — see
 * lib/code.ts) rather than a public constant, so it isn't trivially
 * rainbow-tabled against common IPs.
 */
export function hashIp(ip: string): string {
  const salt = process.env.CODE_SECRET ?? "";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 12);
}

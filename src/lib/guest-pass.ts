/**
 * The guest_pass cookie: a signed, unauthenticated pass scoped to one org for
 * 6 hours (Part 5). Not a session — a guest never has a User row with a
 * password, so there's nothing for NextAuth to authenticate. HMAC-signed with
 * AUTH_SECRET (the same secret already provisioned for NextAuth) so proxy.ts
 * can verify it with zero DB calls, same reasoning as the JWT check it
 * already does for real sessions. Node's crypto is fine here — Proxy defaults
 * to the Node.js runtime as of Next 16 (see node_modules/next/dist/docs
 * upgrading/version-16.md), unlike Middleware before it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const GUEST_PASS_COOKIE = "guest_pass";
export const GUEST_PASS_TTL_MS = 6 * 60 * 60_000;

interface GuestPassPayload {
  orgId: string;
  issuedAt: number;
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return s;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

export function createGuestPassValue(orgId: string, issuedAt: number = Date.now()): string {
  const encoded = Buffer.from(JSON.stringify({ orgId, issuedAt } satisfies GuestPassPayload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${sign(encoded)}`;
}

/** Returns the orgId iff the cookie's signature is valid AND it hasn't expired — never partial trust. */
export function verifyGuestPassValue(value: string | undefined | null, now: number = Date.now()): { orgId: string } | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = value.slice(0, dot);
  const sig = value.slice(dot + 1);

  const expected = sign(encoded);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: GuestPassPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload.orgId || typeof payload.issuedAt !== "number") return null;
  if (now - payload.issuedAt > GUEST_PASS_TTL_MS) return null;
  return { orgId: payload.orgId };
}

export async function setGuestPassCookie(orgId: string): Promise<void> {
  const store = await cookies();
  store.set(GUEST_PASS_COOKIE, createGuestPassValue(orgId), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: GUEST_PASS_TTL_MS / 1000,
    path: "/",
  });
}

/**
 * For Server Components/Actions under /guest/* — proxy.ts already redirects
 * an invalid/missing pass to /guest/join at the edge, but every page here
 * re-checks server-side too (same defense-in-depth precedent as
 * lib/session.ts's DB re-checks) rather than trusting the request ever made
 * it past middleware unmolested.
 */
export async function requireGuestPass(): Promise<{ orgId: string }> {
  const store = await cookies();
  const pass = verifyGuestPassValue(store.get(GUEST_PASS_COOKIE)?.value);
  if (!pass) redirect("/guest/join");
  return pass;
}

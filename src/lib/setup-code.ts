/**
 * Setup codes at rest, and how a typed one is compared. Node only
 * (node:crypto) — not usable on the edge runtime.
 *
 * A setup code is a short-lived credential an admin hands a member by hand, so
 * unlike a password it has to be READABLE again: "Resend code" re-displays the
 * current code instead of issuing a new one (and silently killing the one the
 * member may already have written down). It is therefore stored sealed with
 * AES-256-GCM under a key derived from CODE_SECRET — never in plaintext, and
 * never as a bcrypt hash that can't be shown twice. GCM's tag means a tampered
 * or wrong-key value fails to open rather than decrypting to garbage.
 *
 * A code only lives in User.setupCode while passwordHash is null (a DB CHECK
 * constraint enforces "never both"), and set-password clears it.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const VERSION = "v1";

function key(): Buffer {
  const secret = process.env.CODE_SECRET;
  if (!secret) throw new Error("CODE_SECRET is not set");
  // Domain-separated from lib/code.ts's HMAC use of the same secret.
  return createHash("sha256").update(`setup-code:${VERSION}:${secret}`).digest();
}

/**
 * What a member types is not what was displayed, and the difference must not
 * matter: lowercase, a trailing space from copy-paste, a mobile keyboard's
 * autocapitalisation, "ABCD-EFGH" or "ABCD EFGH" written on an index card, or a
 * hyphen that autocorrect turned into an en dash. Strips every kind of
 * whitespace (including non-breaking and zero-width) and every dash, then
 * uppercases. The generated alphabet is uppercase letters and digits only
 * (lib/passwords.ts), so nothing a real code contains is ever stripped.
 */
export function normalizeSetupCode(input: string): string {
  return input.replace(/[\s​-‍﻿\-‐-―−]+/g, "").toUpperCase();
}

export function sealSetupCode(code: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

/** The stored code, or null for an absent, malformed, tampered, or wrong-key value. Never throws. */
export function openSetupCode(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, iv, tag, ciphertext] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Both sides normalized, then compared in constant time. */
export function setupCodeMatches(submitted: string, sealed: string | null | undefined): boolean {
  const stored = openSetupCode(sealed);
  if (!stored) return false;
  const a = Buffer.from(normalizeSetupCode(submitted), "utf8");
  const b = Buffer.from(normalizeSetupCode(stored), "utf8");
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

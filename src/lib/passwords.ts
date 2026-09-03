/**
 * Password hashing, setup-code generation, and strength checking. Node only
 * (bcryptjs + node:crypto) — not usable on the edge runtime.
 */

import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";

const COST_FACTOR = 12;

/**
 * A real bcrypt hash (cost 12) of a fixed, never-used string — not a real
 * credential. Used only to pay the same bcrypt cost on a failed login when
 * there is no real hash to compare against, so an attacker measuring
 * response time can't distinguish "no such account" from "wrong password".
 */
export const DUMMY_HASH = "$2b$12$A0luqvCNFEeewH0m9iZk6.3P8/znDn8H/DObKQdkoZie4FnKysOF.";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

/** Always compares via bcrypt — never a string equality check. Returns false (never throws) for a blank/missing hash. */
export async function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

// No 0/O/1/I — they're the characters people misread when a code is read aloud
// or handwritten on an index card.
const SETUP_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SETUP_CODE_LENGTH = 8;

/** 8 uppercase chars, ambiguity-free alphabet, drawn with node:crypto (not Math.random). */
export function generateSetupCode(): string {
  let code = "";
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) {
    code += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)];
  }
  return code;
}

export interface PasswordStrengthResult {
  ok: boolean;
  message?: string;
}

const MIN_LENGTH = 10;

// Deliberately small — length is the rule that matters. No symbol/uppercase
// requirements: those push people toward "Password1!" and toward reuse.
const BLOCKLIST = ["password", "nsbe2026", "howard", "12345678", "bison"];

export function validatePasswordStrength(plain: string): PasswordStrengthResult {
  if (plain.length < MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  const lower = plain.toLowerCase();
  if (BLOCKLIST.some((banned) => lower.includes(banned))) {
    return { ok: false, message: "That password is too easy to guess. Try something more unique." };
  }
  return { ok: true };
}

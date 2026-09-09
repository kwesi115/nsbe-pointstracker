/**
 * The one place an email address is normalized before it's compared, stored,
 * or used as a lookup key. Every User.email in the database is written
 * through this (or an equivalent inline call at the one write path that
 * predates this file — see repo.ts createUser-equivalents), so a stored
 * email is always already normalized; this still needs calling on anything
 * that *isn't* guaranteed to have come from the database (form input, a
 * session claim, an admin-typed actor string).
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { normalizeEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { verifyPassword } from "@/lib/passwords";
import { assertNotRateLimited, clearRateLimit, recordFailedAttempt } from "@/lib/rate-limit";
import { getAuthRecord, getMember, getRole, isLoginEmailAllowed } from "@/lib/repo";

/**
 * Thrown instead of a plain AppError so the message survives the trip through
 * Auth.js: a throw from authorize() that ISN'T an AuthError subclass gets
 * turned into an opaque "Configuration" redirect, losing the "N minutes"
 * message entirely. Wrapping the AppError as the cause preserves it — the
 * Server Action that calls signIn() unwraps `error.cause.err` to get it back.
 */
class TooManyAttemptsSignin extends CredentialsSignin {
  code = "too-many-attempts";
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Set by the sign-in Server Action from the httpOnly `org` cookie
        // (see lib/org.ts requireOrgContext()) — never a value the client
        // supplies directly, even though it rides through this same object.
        orgId: { label: "Org", type: "text" },
      },
      async authorize(credentials, request) {
        const email = normalizeEmail(String(credentials?.email ?? ""));
        const password = String(credentials?.password ?? "");
        const orgId = String(credentials?.orgId ?? "");
        if (!email || !password || !orgId) return null;

        const ip = clientIp(request);

        try {
          assertNotRateLimited(email, ip);
        } catch (err) {
          if (err instanceof AppError && err.code === "TOO_MANY_ATTEMPTS") {
            // AuthError's runtime constructor supports `new AuthError(someError)`,
            // wrapping it as `.cause.err` (see @auth/core/errors.js) — that's how
            // the Server Action recovers the exact "N minutes" message. The
            // shipped .d.ts only declares the string-message overload, so the
            // cast below is bridging a real (tested) runtime path, not a hack.
            throw new TooManyAttemptsSignin(err as unknown as string);
          }
          throw err;
        }

        // Domain-or-allowlist gate (Config.ALLOWED_EMAIL_DOMAIN /
        // Config.ADMIN_EMAIL_ALLOWLIST — see lib/repo.ts isLoginEmailAllowed).
        // Checked before the roster lookup, and failing it looks exactly like
        // a wrong password: never reveal via timing or message whether an
        // account exists for a rejected address.
        if (!(await isLoginEmailAllowed(orgId, email))) {
          await verifyPassword(password, undefined);
          recordFailedAttempt(email, ip);
          return null;
        }

        const [member, authRecord] = await Promise.all([getMember(orgId, email), getAuthRecord(orgId, email)]);

        // No such row on the roster — run the dummy compare so the response
        // takes the same time as a real failed check, then fail the same way.
        if (!authRecord) {
          await verifyPassword(password, undefined);
          recordFailedAttempt(email, ip);
          return null;
        }

        // A GUEST row (from registerGuest — see lib/repo.ts) has no password
        // at all: passwordHash is null, not merely unguessable. Reject
        // outright, before ever touching bcrypt, regardless of what was
        // submitted — a guest must never be able to sign in (Part 5). Still
        // pay the dummy-compare cost so this branch takes the same time as a
        // real failed check.
        if (authRecord.role === "guest" || authRecord.passwordHash === null) {
          await verifyPassword(password, undefined);
          recordFailedAttempt(email, ip);
          return null;
        }

        const name = [member?.firstName, member?.lastName].filter(Boolean).join(" ") || email;
        const role = member?.role ?? "general";

        const ok = await verifyPassword(password, authRecord.passwordHash);
        if (!ok) {
          recordFailedAttempt(email, ip);
          return null;
        }
        clearRateLimit(email);
        return {
          email,
          name,
          role,
          orgId,
          mustChangePassword: authRecord.mustChangePassword,
          status: authRecord.status,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  trustHost: true,
  callbacks: {
    // A session and a guest_pass must never coexist (Part 3) — this is
    // defense in depth on top of the (public)/(guest) layout guards, so a
    // successful sign-in through any path (credentials form, the join
    // wizard's post-signup sign-in, set-password's re-sign-in) always sheds
    // a stale guest_pass rather than relying on the caller to remember to.
    async signIn() {
      const store = await cookies();
      store.delete(GUEST_PASS_COOKIE);
      return true;
    },

    async jwt({ token, user }) {
      if (user) {
        token.email = user.email ?? token.email;
        token.role = user.role ?? "general";
        token.orgId = user.orgId ?? token.orgId;
        token.mustChangePassword = user.mustChangePassword ?? false;
        token.status = user.status ?? "pending";
      }
      return token;
    },

    async session({ session, token }) {
      const email = typeof token.email === "string" ? token.email : "";
      const orgId = typeof token.orgId === "string" ? token.orgId : "";
      session.user.email = email;
      session.user.orgId = orgId;
      if (!email || !orgId) {
        session.user.role = "general";
        session.user.mustChangePassword = false;
        session.user.status = "pending";
        return session;
      }
      // Re-read role/mustChangePassword/status on every session check, same
      // reasoning as before — a JWT minted before a promotion, a password
      // set, or an approval still looks stale until it's re-issued.
      const [role, authRecord] = await Promise.all([getRole(orgId, email), getAuthRecord(orgId, email)]);
      session.user.role = role;
      session.user.mustChangePassword = authRecord?.mustChangePassword ?? false;
      session.user.status = authRecord?.status ?? "pending";
      return session;
    },
  },
});

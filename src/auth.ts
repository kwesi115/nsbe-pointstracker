import NextAuth, { CredentialsSignin, type Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { cookies } from "next/headers";
import { normalizeEmail } from "@/lib/email";
import { AppError } from "@/lib/errors";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { checkCredentials } from "@/lib/credentials";
import { verifyPassword } from "@/lib/passwords";
import { assertNotRateLimited, clearRateLimit, recordFailedAttempt } from "@/lib/rate-limit";
import { getAuthRecord, getMember, getSessionUser, isLoginEmailAllowed } from "@/lib/repo";

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

/**
 * The session auth() hands back when there is nobody to hand back: no usable
 * identity in the token, no matching row, or a database error while looking
 * one up. Every guard reads it as signed out — lib/session.ts requireSession()
 * throws UNAUTHENTICATED, (member)/layout.tsx redirects to /signin, and
 * (public)/layout.tsx renders the sign-in page instead of bouncing to /events.
 *
 * `user: undefined` is EXPLICIT, and that is load-bearing rather than
 * stylistic. next-auth's server-side wrapper around this callback returns
 * `{ user: token, ...whatOurCallbackReturned }` (see
 * node_modules/next-auth/lib/index.js getSession) — so omitting the key, or
 * returning null, hands the caller the raw JWT as the session user. That is
 * failing OPEN, with a role and an orgId, on exactly the database error this
 * function exists to survive. Naming the key lets our value win the spread.
 */
function signedOutSession(session: Session): Session {
  return { ...session, user: undefined } as unknown as Session;
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

        const name = [member?.firstName, member?.lastName].filter(Boolean).join(" ") || email;
        const role = member?.role ?? "general";

        // Guest rows (never), pending setup codes (forgiving about case,
        // spaces and hyphens), legacy codes and real passwords — see
        // lib/credentials.ts. Every failing branch there pays the same bcrypt
        // cost, so the response time doesn't reveal which kind of account it is.
        const check = await checkCredentials(authRecord, password);
        if (!check.ok) {
          recordFailedAttempt(email, ip);
          return null;
        }
        clearRateLimit(email);
        return {
          email,
          name,
          role,
          orgId,
          mustChangePassword: check.mustChangePassword,
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

    /**
     * Runs on EVERY auth() call — every layout, page, Server Action and route
     * handler in the app. That is why it reads as narrowly as it possibly can,
     * and why it cannot be allowed to throw.
     *
     * It used to call repo.getAuthRecord(). The reason was mundane: it needed
     * mustChangePassword and the signup verdict, and AuthRecord was the only
     * getter that carried them (Member carries role and status, but not
     * mustChangePassword). getAuthRecord is a bare findUnique, so it selects
     * EVERY column of User — including passwordHash and setupCode, neither of
     * which a session has any business touching. When setupCode existed in the
     * Prisma model but not in the database, that SELECT failed, and because
     * this callback runs everywhere, it took down every page — the public
     * sign-in page included, leaving no way back in.
     *
     * Now it calls repo.getSessionUser(), which names its seven columns, and
     * getAuthRecord is what its own doc comment always said it was: the
     * credentials authorize() path only, where a password actually gets
     * checked. Two queries became one, as a side effect.
     */
    async session({ session, token }) {
      const email = typeof token.email === "string" ? token.email : "";
      const orgId = typeof token.orgId === "string" ? token.orgId : "";
      // Nothing to look up. Previously this returned a session carrying an
      // empty email and default fields, which requireSession() rejects but
      // (public)/layout.tsx reads as signed in — a token in this state would
      // have volleyed between /signin and /events. Signed out is the honest
      // answer and the only one both guards agree on.
      if (!email || !orgId) return signedOutSession(session);

      let record;
      try {
        // Re-read role/status/mustChangePassword on every session check, same
        // reasoning as before — a JWT minted before a promotion, a password
        // set, or an approval still looks stale until it's re-issued.
        record = await getSessionUser(orgId, email);
      } catch (err) {
        // A DEGRADE, NOT A CRASH. Throwing from here propagates out of auth()
        // into whichever layout called it, and (public)/layout.tsx is one of
        // them — so a database hiccup would take down the very page that
        // renders the sign-in form, locking everyone out with a 500 instead of
        // a login box. Signing the request out keeps /signin reachable, and
        // the next successful call signs the user straight back in: the JWT
        // cookie is untouched, only this request's view of it is.
        console.error(
          `[auth] session lookup failed for ${email} in org ${orgId}; degrading to a signed-out session`,
          err,
        );
        return signedOutSession(session);
      }

      // The row is gone (deleted, or moved to another org). An account that no
      // longer exists is not a session.
      if (!record) return signedOutSession(session);

      session.user.id = record.id;
      session.user.email = record.email;
      session.user.orgId = record.orgId;
      session.user.role = record.role;
      session.user.status = record.status;
      session.user.mustChangePassword = record.mustChangePassword;
      // The LATCH, read live — (member)/layout.tsx redirects a mid-signup
      // account to /join/resume and /join/resume redirects a finished one back
      // out, so a value that could lag behind the database is precisely a
      // redirect loop.
      //
      // The column, not lib/signup.ts signupIsComplete's verdict: the verdict
      // needs the whole profile, and reading the whole profile here is the
      // coupling this change exists to remove. The pair still cannot disagree,
      // because /join/resume closes the one gap between them — a row the
      // predicate considers finished but that carries no latch gets latched
      // there and sent on, rather than bounced back (see that page). So the
      // latch is the single source of truth for the gate, and every row the
      // old code would have called complete still ends up complete, once.
      session.user.signupComplete = record.signupCompletedAt !== null;
      return session;
    },
  },
});

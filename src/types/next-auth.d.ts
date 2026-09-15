import type { DefaultSession, DefaultUser } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import type { Role, UserStatus } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
      /** The User row's cuid. Read straight from the row the session callback already selects, so a caller needing a foreign key doesn't have to re-resolve the email. */
      id: string;
      /** Always the normalized (lowercased) email — never null/undefined once signed in. */
      email: string;
      /** Re-read from the roster on every session check — see auth.ts session callback. */
      role: Role;
      /** The org this session was minted for — see lib/session.ts assertOrgMatch. Never re-derived from anything client-supplied. */
      orgId: string;
      /** True only for a session established with a setup code. Gates /set-password. */
      mustChangePassword: boolean;
      /** Re-read on every session check. PENDING/SUSPENDED can sign in but not register — see /pending. */
      status: UserStatus;
      /**
       * False while the account is still mid-signup (see lib/signup.ts). Re-read
       * live on every session check, NOT carried in the JWT: a stale "false" in
       * a token would outlive the moment signup finished and pin the member in
       * the resume flow. (member)/layout.tsx is the gate that reads it.
       */
      signupComplete: boolean;
    } & DefaultSession["user"];
  }

  /** The shape authorize() returns — see auth.ts. */
  interface User extends DefaultUser {
    role?: Role;
    orgId?: string;
    mustChangePassword?: boolean;
    status?: UserStatus;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    email?: string;
    role?: Role;
    orgId?: string;
    /** Read directly by middleware via getToken() — never via the session callback. */
    mustChangePassword?: boolean;
    /** Read directly by middleware via getToken() for the /events PENDING/SUSPENDED redirect. */
    status?: UserStatus;
  }
}

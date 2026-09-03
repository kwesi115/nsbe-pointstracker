import type { DefaultSession, DefaultUser } from "next-auth";
import type { DefaultJWT } from "next-auth/jwt";
import type { Role, UserStatus } from "@/lib/types";

declare module "next-auth" {
  interface Session {
    user: {
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

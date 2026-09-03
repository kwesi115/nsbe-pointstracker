"use server";

import { cookies } from "next/headers";
import { auth, signOut } from "@/auth";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { getOrgById } from "@/lib/repo";

/**
 * Signing out clears both cookies and lands on the org landing, not "/" —
 * the user keeps their org selection, they just aren't signed in (Part 5).
 * A guest_pass shouldn't coexist with a session in the first place (Part 3),
 * but this clears it anyway rather than assume that invariant held.
 */
export async function signOutAction(): Promise<void> {
  const session = await auth();
  const store = await cookies();
  store.delete(GUEST_PASS_COOKIE);

  const org = session?.user?.orgId ? await getOrgById(session.user.orgId) : null;
  await signOut({ redirectTo: org ? `/org/${org.slug}` : "/" });
}

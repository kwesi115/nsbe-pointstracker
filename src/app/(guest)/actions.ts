"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { GUEST_PASS_COOKIE } from "@/lib/guest-pass";
import { getOrgIdFromCookie } from "@/lib/org";
import { getOrgById } from "@/lib/repo";

/** Clears the pass and returns to the org landing (Part 7) — the `org` cookie survives this, only the pass is cleared. */
export async function exitGuestModeAction(): Promise<void> {
  const orgId = await getOrgIdFromCookie();
  const store = await cookies();
  store.delete(GUEST_PASS_COOKIE);

  const org = orgId ? await getOrgById(orgId) : null;
  redirect(org ? `/org/${org.slug}` : "/");
}

"use server";

import { redirect } from "next/navigation";
import { setOrgCookie } from "@/lib/org";

/**
 * The one place the `org` cookie gets set (Part 2/6) — bound with a specific
 * orgId + destination at each call site (the org-card buttons on `/`, and the
 * three action buttons on `/org/[slug]`). A plain <Link> can't write a
 * cookie, so every one of those is a form around this action instead.
 */
export async function continueWithOrg(orgId: string, target: string): Promise<void> {
  await setOrgCookie(orgId);
  redirect(target);
}

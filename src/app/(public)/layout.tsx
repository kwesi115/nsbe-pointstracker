import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { auth } from "@/auth";
import { getConfigValue, getOrgById } from "@/lib/repo";
import { getOrgIdFromCookie } from "@/lib/org";
import { isResumePath } from "@/lib/signup-routes";

/**
 * Bare chrome for /, /org/[slug], /signin, /join — org name only, no nav, no
 * user menu (Part 1). A signed-in member can't see most of these: the
 * exceptions are "/" itself, which stays reachable for a signed-in user who
 * has no org cookie yet (Part 2), "/join" — the join wizard signs the user in
 * immediately after step 3 (account creation), so steps 4-8 render (and POST
 * their Server Actions) while authenticated — and "/join/resume", for the same
 * reason one step further on: a member resuming an unfinished signup is signed
 * in by definition. Everything else bounces to /events outright.
 *
 * The /join/resume exemption is not optional. (member)/layout.tsx sends an
 * unfinished signup TO /join/resume; if this guard bounced it back to /events,
 * the two would volley forever. The exemption is what makes the gate's one
 * entry point reachable — see lib/signup-routes.ts.
 *
 * The pathname comes from the `x-pathname` header proxy.ts stamps on every
 * request (see src/proxy.ts) — layouts don't receive it as a prop, only pages
 * do, and this check has to run before any specific page renders. proxy.ts
 * carries the identical /join exception at the middleware layer, since it
 * runs before this layout does.
 */
export default async function PublicLayout({ children }: { children: ReactNode }) {
  const [session, headerList, orgId] = await Promise.all([auth(), headers(), getOrgIdFromCookie()]);

  if (session?.user) {
    const pathname = headerList.get("x-pathname") ?? "";
    const isHomeWithoutOrg = pathname === "/" && !orgId;
    const isJoinWizard = pathname === "/join" || isResumePath(pathname);
    if (!isHomeWithoutOrg && !isJoinWizard) {
      redirect("/events");
    }
  }

  const [org, chapterName] = await Promise.all([
    orgId ? getOrgById(orgId) : Promise.resolve(null),
    orgId ? getConfigValue(orgId, "CHAPTER_NAME", "NSBE") : Promise.resolve("NSBE"),
  ]);

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-line px-6 py-4">
        <span className="font-display text-sm font-bold text-ink">{org?.name ?? chapterName}</span>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

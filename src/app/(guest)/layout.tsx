import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { exitGuestModeAction } from "./actions";
import { auth } from "@/auth";
import { GUEST_PASS_COOKIE, verifyGuestPassValue } from "@/lib/guest-pass";
import { getOrgIdFromCookie } from "@/lib/org";
import { getOrgById } from "@/lib/repo";

/**
 * Bare chrome for every /guest/* route (Part 7) — org name, a "Guest" badge,
 * and an exit control, no nav, no links into the member app, not even a logo
 * that navigates home. A signed-in member never has a reason to be here — the
 * redirect below closes the "continue as guest while signed in" path at the
 * entry point itself, on top of proxy.ts's cookie-level check (Part 2/4).
 */
export default async function GuestLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (session?.user) {
    redirect("/events");
  }

  const store = await cookies();
  const pass = verifyGuestPassValue(store.get(GUEST_PASS_COOKIE)?.value);
  const orgId = pass?.orgId ?? (await getOrgIdFromCookie());
  const org = orgId ? await getOrgById(orgId) : null;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="flex items-center gap-2">
          <span className="font-display text-sm font-bold text-ink">{org?.name ?? "Guest check-in"}</span>
          <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-muted">
            Guest
          </span>
        </div>
        {pass ? (
          <form action={exitGuestModeAction}>
            <button
              type="submit"
              className="min-h-11 text-sm font-medium text-muted underline underline-offset-2 hover:text-ink"
            >
              Exit guest mode
            </button>
          </form>
        ) : null}
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

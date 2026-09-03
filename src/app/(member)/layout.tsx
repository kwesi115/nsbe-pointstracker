import { redirect } from "next/navigation";
import MemberNav from "@/components/MemberNav";
import { AppError } from "@/lib/errors";
import { requireSession } from "@/lib/session";

/**
 * Shared chrome for every member route — full nav, user menu, and the real
 * (not just Proxy's cookie-shaped) session check (Part 1/4). proxy.ts already
 * bounces an unauthenticated request before it gets here; this is the
 * defense-in-depth layer that doesn't trust a cookie shape alone.
 *
 * The projector display (src/app/admin/events/[id]/display) lives outside
 * this route group deliberately, so it gets only the bare root layout: no
 * nav, no padding, full control of the screen for the wall.
 */
export default async function MemberLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof AppError && err.code === "UNAUTHENTICATED") {
      redirect("/signin");
    }
    throw err;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <MemberNav session={session} />
      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  );
}

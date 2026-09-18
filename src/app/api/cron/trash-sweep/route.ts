import { NextResponse } from "next/server";
import { getActiveOrgs, runTrashSweep, type TrashSweepResult } from "@/lib/repo";

// Permanent deletion reads and writes stored files (lib/storage.ts's local
// driver needs node:fs) — not available on the edge runtime.
export const runtime = "nodejs";

/**
 * The trash bin's expiry, callable by a scheduler — Vercel Cron, or anything
 * else that can send a GET with a header. There is no cron configured in this
 * project today; the sweep otherwise runs lazily on /admin and /admin/trash
 * loads (see lib/repo.ts runTrashSweep), which leaves expired items sitting
 * whenever no admin visits.
 *
 * Authenticated by CRON_SECRET, the convention Vercel Cron uses: it sends
 * `Authorization: Bearer <CRON_SECRET>` when that variable is set on the
 * project. With no secret configured the route refuses everything rather than
 * running open — anyone could otherwise trigger permanent deletions on demand.
 *
 * Goes through the same hourly claim and the same backup check as the lazy
 * sweep: a cron firing while an admin page is sweeping does nothing twice, and
 * with backup storage unconfigured it reports "paused" and deletes nothing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ code: "NOT_CONFIGURED", message: "CRON_SECRET is not set." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ code: "UNAUTHENTICATED", message: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{ org: string } & ({ error: string } | { result: SweepSummary })> = [];
  for (const org of await getActiveOrgs()) {
    try {
      results.push({ org: org.slug, result: summarize(await runTrashSweep(org.id, { actor: "cron" })) });
    } catch (err) {
      // One org's failure must not stop the others; the detail is in the server log.
      console.error("[trash] cron sweep failed", { org: org.slug, err });
      results.push({ org: org.slug, error: "Sweep failed — see server logs." });
    }
  }
  return NextResponse.json({ results });
}

type SweepSummary =
  | { ran: false; reason: string }
  | { ran: true; purged: number; failures: number };

/** Counts only — the response never echoes emails or event names back to whatever called it. */
function summarize(r: TrashSweepResult): SweepSummary {
  return r.ran ? { ran: true, purged: r.purged.length, failures: r.failures.length } : { ran: false, reason: r.reason };
}

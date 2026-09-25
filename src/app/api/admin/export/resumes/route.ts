import { RESUME_BUNDLE_ACCESS } from "@/lib/access";
import { requireAccess } from "@/lib/access-guards";
import { withApiErrors } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { checkBundleLimits, streamResumeBundle } from "@/lib/export/resume-bundle";
import { getResumeBundleRows, getResumeBundleTicket } from "@/lib/repo";

// The local-disk storage driver needs node:fs, and @vercel/blob's private
// get() is a Node-runtime call — not available on the edge runtime.
export const runtime = "nodejs";

/**
 * A bundle at the top of the cap is a couple of hundred round trips to blob
 * storage plus the client's download time, and the platform default (10s)
 * would kill it mid-archive — handing the admin a truncated zip with no error,
 * because the status line has already gone out by then.
 *
 * 60 rather than a larger number on purpose: 60s is the ceiling every Vercel
 * plan allows, and a maxDuration above a project's plan limit fails the
 * DEPLOY, not the request. The count and byte caps in
 * lib/export/resume-bundle.ts are sized to finish inside this even at a
 * pessimistic 150ms per blob read.
 */
export const maxDuration = 60;

/**
 * The resume bundle's bytes. POST, and only ever for a TICKET.
 *
 * The ticket is what makes the audit trail airtight. lib/repo.ts
 * createResumeBundleRequest writes the AdminLog entry and stores the selection
 * on the same RequestClaim row in one transaction; this route reads the
 * selection back OUT of that row and never from the request body. So the
 * filters that were logged are necessarily the filters that get streamed, and
 * there is no way to reach the bytes without having first written the entry.
 *
 * Access is re-checked here anyway rather than trusted from the ticket: a
 * grant revoked in the seconds between confirming and downloading has to take
 * effect, same reasoning as lib/access-guards.ts loadAdminAccess re-reading
 * the role on every request. The ticket is also bound to the actor it was
 * logged for, so a second holder of the grant cannot redeem someone else's
 * and leave the wrong name on the only record of it.
 */
export const POST = withApiErrors(async (request: Request) => {
  const session = await requireAccess(RESUME_BUNDLE_ACCESS);

  const body = (await request.json().catch(() => null)) as { ticket?: unknown } | null;
  const ticket = typeof body?.ticket === "string" ? body.ticket : "";

  const selection = await getResumeBundleTicket(session.user.orgId, ticket, session.user.email);
  if (!selection) {
    throw new AppError("VALIDATION_FAILED", "That download has expired. Confirm the download again to start a new one.");
  }

  const rows = await getResumeBundleRows(session.user.orgId, selection);
  // Belt and braces: the action refuses an empty selection before it logs
  // anything, but an empty zip is a confusing artifact to hand anyone, so
  // nothing here can produce one either.
  if (rows.length === 0) {
    throw new AppError("VALIDATION_FAILED", "No resumes with consent on file match that selection — nothing to download.");
  }

  const limits = checkBundleLimits(rows);
  if (!limits.ok) throw new AppError("VALIDATION_FAILED", limits.message ?? "That bundle is too large.");

  const { stream, filename } = streamResumeBundle(rows);

  // No Content-Length: the archive's size isn't known until it's written, which
  // is the whole point of streaming it. No Content-Encoding either — the
  // entries are stored uncompressed and gzipping a zip of PDFs buys nothing.
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
});

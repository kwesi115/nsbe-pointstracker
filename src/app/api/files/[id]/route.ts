import { normalizeEmail } from "@/lib/email";
import { canAccessFile, getUploadedFileForServing, logFileView } from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { storage } from "@/lib/storage";

// Needs node:fs (the dev disk driver) — not available on the edge runtime.
export const runtime = "nodejs";

/**
 * Owner or EBOARD only. 404 (never 403) for anyone else, so the endpoint
 * doesn't confirm a file exists — see prisma/schema.prisma's UploadedFile doc
 * comment and Part 4 of the plan.
 *
 * This is the ONLY way file bytes reach a browser: storageKey is never a public
 * URL and never leaves the server (see lib/storage.ts), so every <img> in the
 * app — thumbnail and lightbox alike — points here and is authorized per
 * request.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession().catch(() => null);
  if (!session) return new Response(null, { status: 404 });

  const { id } = await ctx.params;
  const file = await getUploadedFileForServing(session.user.orgId, id);
  if (!file) return new Response(null, { status: 404 });

  if (!canAccessFile(file, session.user)) return new Response(null, { status: 404 });

  // The FILES domain's audit trail. Written before the bytes go out, and only
  // for a viewer who isn't the owner.
  //
  // A failure here does NOT deny the read: the request is already authorized,
  // and an officer stuck mid-verification because a log insert failed is a worse
  // outcome than a gap in the trail. It is loud in the server log instead.
  if (normalizeEmail(file.ownerEmail) !== normalizeEmail(session.user.email)) {
    try {
      await logFileView(session.user.orgId, {
        actor: session.user.email,
        fileId: file.id,
        kind: file.kind,
        ownerEmail: file.ownerEmail,
        originalName: file.originalName,
      });
    } catch (err) {
      console.error("failed to log file view", { fileId: file.id, actor: session.user.email, err });
    }
  }

  const bytes = await storage.read(file.storageKey);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(file.originalName)}"`,
      "Content-Length": String(file.sizeBytes),
      "Cache-Control": "private, no-store",
    },
  });
}

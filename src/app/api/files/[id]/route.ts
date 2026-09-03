import { canAccessFile, getUploadedFileForServing } from "@/lib/repo";
import { requireSession } from "@/lib/session";
import { storage } from "@/lib/storage";

// Needs node:fs (the dev disk driver) — not available on the edge runtime.
export const runtime = "nodejs";

/**
 * Owner or EBOARD only. 404 (never 403) for anyone else, so the endpoint
 * doesn't confirm a file exists — see prisma/schema.prisma's UploadedFile doc
 * comment and Part 4 of the plan.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireSession().catch(() => null);
  if (!session) return new Response(null, { status: 404 });

  const { id } = await ctx.params;
  const file = await getUploadedFileForServing(session.user.orgId, id);
  if (!file) return new Response(null, { status: 404 });

  if (!canAccessFile(file, session.user)) return new Response(null, { status: 404 });

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

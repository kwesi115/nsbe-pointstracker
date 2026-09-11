import { withApiErrors } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { buildMembersCsv } from "@/lib/export/csv";
import { requireAccess } from "@/lib/access-guards";

/** POST, not GET — the selected-emails payload can exceed a URL's practical length (see /admin/members "Export selected"). */
/** E-Board or above AND the org's exports switch on — see lib/features.ts. A 403 from here is JSON ({ code, message }), never HTML: this is an API route. */
const EXPORT_ACCESS = { level: "eboard", feature: "exports" } as const;

export const POST = withApiErrors(async (request: Request) => {
  const session = await requireAccess(EXPORT_ACCESS);
  const body = await request.json().catch(() => null);
  const emails = Array.isArray(body?.emails) ? body.emails.filter((e: unknown): e is string => typeof e === "string") : null;
  if (!emails || emails.length === 0) throw new AppError("VALIDATION_FAILED", "No members selected");

  const { csv, filename } = await buildMembersCsv(session.user.orgId, emails);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

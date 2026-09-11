import { withApiErrors } from "@/lib/api";
import { buildEventResponsesCsv } from "@/lib/export/csv";
import { requireAccess } from "@/lib/access-guards";

/** E-Board or above AND the org's exports switch on — see lib/features.ts. A 403 from here is JSON ({ code, message }), never HTML: this is an API route. */
const EXPORT_ACCESS = { level: "eboard", feature: "exports" } as const;

export const GET = withApiErrors(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireAccess(EXPORT_ACCESS);
  const { id } = await ctx.params;
  const { csv, filename } = await buildEventResponsesCsv(session.user.orgId, id);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

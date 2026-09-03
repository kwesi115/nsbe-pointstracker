import { withApiErrors } from "@/lib/api";
import { buildEventResponsesCsv } from "@/lib/export/csv";
import { requireEboard } from "@/lib/session";

export const GET = withApiErrors(async (_request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireEboard();
  const { id } = await ctx.params;
  const { csv, filename } = await buildEventResponsesCsv(session.user.orgId, id);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

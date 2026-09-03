import { withApiErrors } from "@/lib/api";
import { buildEboardLeaderboardCsv } from "@/lib/export/csv";
import { requireEboard } from "@/lib/session";

export const GET = withApiErrors(async () => {
  const session = await requireEboard();
  const { csv, filename } = await buildEboardLeaderboardCsv(session.user.orgId);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

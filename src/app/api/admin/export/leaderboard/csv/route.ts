import { withApiErrors } from "@/lib/api";
import { buildLeaderboardCsv } from "@/lib/export/csv";
import { requireAccess } from "@/lib/access-guards";

/** E-Board or above AND the org's exports switch on — see lib/features.ts. A 403 from here is JSON ({ code, message }), never HTML: this is an API route. */
const EXPORT_ACCESS = { level: "eboard", feature: "exports" } as const;

export const GET = withApiErrors(async () => {
  const session = await requireAccess(EXPORT_ACCESS);
  const { csv, filename } = await buildLeaderboardCsv(session.user.orgId);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

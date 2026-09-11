import { withApiErrors } from "@/lib/api";
import { buildWorkbookExport } from "@/lib/export/workbook";
import { requireAccess } from "@/lib/access-guards";

/** E-Board or above AND the org's exports switch on — see lib/features.ts. A 403 from here is JSON ({ code, message }), never HTML: this is an API route. */
const EXPORT_ACCESS = { level: "eboard", feature: "exports" } as const;

export const GET = withApiErrors(async () => {
  const session = await requireAccess(EXPORT_ACCESS);
  const buffer = await buildWorkbookExport(session.user.orgId);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="nsbe-points-${stamp}.xlsx"`,
    },
  });
});

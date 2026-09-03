import { withApiErrors } from "@/lib/api";
import { buildWorkbookExport } from "@/lib/export/workbook";
import { requireEboard } from "@/lib/session";

export const GET = withApiErrors(async () => {
  const session = await requireEboard();
  const buffer = await buildWorkbookExport(session.user.orgId);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="nsbe-points-${stamp}.xlsx"`,
    },
  });
});

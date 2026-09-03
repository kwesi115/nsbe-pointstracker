import { withApiErrors } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { buildMembersCsv } from "@/lib/export/csv";
import { requireEboard } from "@/lib/session";

/** POST, not GET — the selected-emails payload can exceed a URL's practical length (see /admin/members "Export selected"). */
export const POST = withApiErrors(async (request: Request) => {
  const session = await requireEboard();
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

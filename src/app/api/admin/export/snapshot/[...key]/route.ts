import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { SNAPSHOT_PREFIX_FOR } from "@/lib/export/snapshot";
import { backupStorage } from "@/lib/storage";
import { requireAccess } from "@/lib/access-guards";

/** E-Board or above AND the org's exports switch on — see lib/features.ts. A 403 from here is JSON ({ code, message }), never HTML: this is an API route. */
const EXPORT_ACCESS = { level: "eboard", feature: "exports" } as const;

/** Downloads one prior season snapshot — see /admin/exports. The key's org prefix is checked against the caller's own orgId so an E-Board member can never guess another org's snapshot key. */
export const GET = withApiErrors(async (_request: Request, ctx: { params: Promise<{ key: string[] }> }) => {
  const session = await requireAccess(EXPORT_ACCESS);
  const { key: segments } = await ctx.params;
  const key = segments.join("/");

  if (!key.startsWith(SNAPSHOT_PREFIX_FOR(session.user.orgId))) {
    throw new AppError("NOT_FOUND", "Snapshot not found");
  }

  let buffer: Buffer;
  try {
    buffer = await backupStorage.read(key);
  } catch {
    throw new AppError("NOT_FOUND", "Snapshot not found");
  }

  const filename = key.split("/").pop() ?? "snapshot.xlsx";
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

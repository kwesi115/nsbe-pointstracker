import { withApiErrors } from "@/lib/api";
import { eventsQrPng } from "@/lib/qr";
import { requireEboard } from "@/lib/session";

export const GET = withApiErrors(async () => {
  await requireEboard();
  const png = await eventsQrPng();
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Disposition": 'attachment; filename="nsbe-events-qr.png"',
    },
  });
});

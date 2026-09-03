import { withApiErrors } from "@/lib/api";
import { eventsQrSvg } from "@/lib/qr";
import { requireEboard } from "@/lib/session";

export const GET = withApiErrors(async () => {
  await requireEboard();
  const svg = await eventsQrSvg();
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Content-Disposition": 'attachment; filename="nsbe-events-qr.svg"',
    },
  });
});

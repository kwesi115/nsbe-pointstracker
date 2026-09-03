import { Download } from "lucide-react";
import AdminNav from "@/components/admin/AdminNav";
import Card from "@/components/ui/Card";
import { eventsQrSvg, eventsUrl } from "@/lib/qr";
import { requireEboard } from "@/lib/session";

export default async function AdminQrPage() {
  await requireEboard();
  const [svg, url] = await Promise.all([eventsQrSvg(), Promise.resolve(eventsUrl())]);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <div className="print:hidden">
        <h1 className="font-display text-2xl font-bold text-ink">Chapter QR code</h1>
        <p className="text-sm text-muted">
          This code never changes and never expires — print it once and post it wherever members check in.
        </p>
      </div>
      <div className="print:hidden">
        <AdminNav active="/admin/qr" />
      </div>

      <Card className="flex flex-col items-center gap-4 text-center">
        <div className="w-64 max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="numeric text-sm text-muted">{url}</p>

        <div className="flex gap-2 print:hidden">
          <a
            href="/api/admin/qr/svg"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
          >
            <Download size={16} aria-hidden="true" /> SVG
          </a>
          <a
            href="/api/admin/qr/png"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
          >
            <Download size={16} aria-hidden="true" /> PNG
          </a>
        </div>
      </Card>
    </main>
  );
}

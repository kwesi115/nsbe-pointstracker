import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../../../_components/AccessDenied";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import GameBonusAward from "@/components/admin/GameBonusAward";
import ResponsesTable from "@/components/admin/ResponsesTable";
import { getEvent, getEventResponses, getFormFields } from "@/lib/repo";

export default async function EventResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdminPage({ level: "eboard" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const orgId = session.user.orgId;
  const { id } = await params;
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const [fields, responses] = await Promise.all([getFormFields(orgId, event.eventId), getEventResponses(orgId, id)]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Responses — {event.name}</h1>
          <p className="numeric text-sm text-muted">{responses.length} checked in</p>
        </div>
        <div className="flex items-center gap-2">
          <GameBonusAward eventId={id} responses={responses} />
          {/* Same flag that gates the endpoint behind it — see lib/features.ts. */}
          {guard.access.features.exports ? (
            <a
              href={`/api/admin/export/event/${id}/csv`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
            >
              <Download size={16} aria-hidden="true" /> Export CSV
            </a>
          ) : null}
        </div>
      </div>

      <ResponsesTable
        responses={responses}
        fieldKeys={fields.map((f) => f.fieldKey)}
        fieldLabels={fields.map((f) => f.label || f.fieldKey)}
      />
    </main>
  );
}

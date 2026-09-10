import { ShieldAlert } from "lucide-react";
import AdminNav from "@/components/admin/AdminNav";
import EventsBoard from "@/components/admin/EventsBoard";
import Button from "@/components/ui/Button";
import { getEventCodeAlertState } from "@/lib/rate-limit";
import { getEventsWithStats } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export default async function AdminEventsPage() {
  const session = await requireEboard();
  const events = await getEventsWithStats(session.user.orgId);
  const eventsWithAlerts = events.map((e) => ({ ...e, codeAlert: getEventCodeAlertState(e.eventId) }));
  const suspiciousEvents = eventsWithAlerts.filter((e) => e.codeAlert.suspicious);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold text-ink">Events</h1>
        <Button href="/admin/events/new">New event</Button>
      </div>
      <AdminNav active="/admin" />

      {suspiciousEvents.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-ink">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldAlert size={16} aria-hidden="true" /> Unusual check-in code activity
          </p>
          <ul className="flex flex-col gap-1">
            {suspiciousEvents.map((e) => (
              <li key={e.eventId} className="text-xs text-muted">
                {e.name} — {e.codeAlert.locked ? "check-in paused" : "elevated failed-attempt volume"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <EventsBoard initialEvents={eventsWithAlerts} />
    </main>
  );
}

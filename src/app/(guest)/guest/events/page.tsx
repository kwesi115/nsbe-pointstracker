import { CalendarClock } from "lucide-react";
import Link from "next/link";
import Countdown from "@/components/Countdown";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { requireGuestPass } from "@/lib/guest-pass";
import { getOpenGuestEvents } from "@/lib/repo";

/** Requires a valid guest_pass (proxy.ts already enforces this at the edge; requireGuestPass() re-checks server-side). Only ALL-audience events that are open right now — never EBOARD_ONLY, never a point value (guests earn none). */
export default async function GuestEventsPage() {
  const { orgId } = await requireGuestPass();
  const events = await getOpenGuestEvents(orgId, new Date());

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Open events</h1>

      {events.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No events are open right now." />
      ) : (
        <div className="flex flex-col gap-3">
          {events.map((event) => (
            <Link
              key={event.eventId}
              href={`/guest/events/${event.eventId}`}
              className="block rounded-xl focus-visible:outline-offset-4"
            >
              <Card className="flex items-start justify-between gap-3 transition-colors hover:border-signal">
                <div>
                  <h2 className="font-display text-lg font-bold text-ink">{event.name}</h2>
                  <p className="text-sm text-muted">
                    {event.category.name} · {event.location || "Location TBD"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <Badge tone="signal">Open</Badge>
                  {event.closesAt ? (
                    <p className="mt-1 text-xs text-muted">
                      Closes in <Countdown to={event.closesAt} className="font-semibold text-ink" />
                    </p>
                  ) : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}

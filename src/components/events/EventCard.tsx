import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import Countdown from "@/components/Countdown";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { formatDate, formatDateTime } from "@/lib/format";
import type { Event } from "@/lib/types";

export default function EventCard({
  event,
  isOpen,
  registered,
}: {
  event: Event;
  isOpen: boolean;
  registered: boolean;
}) {
  return (
    <Link href={`/events/${event.eventId}`} className="block rounded-xl focus-visible:outline-offset-4">
      <Card className="flex flex-col gap-2 transition-colors hover:border-signal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{event.name}</h3>
            <p className="text-sm text-muted">
              {event.category.shortName} · +{event.points ?? event.category.memberPoints} · {formatDate(event.date)} ·{" "}
              {event.location || "Location TBD"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {event.audience === "eboard_only" ? <Badge tone="amber">E-Board</Badge> : null}
            {isOpen ? <Badge tone="signal">Open</Badge> : <Badge tone="muted">Scheduled</Badge>}
          </div>
        </div>

        {registered ? (
          <p className="flex items-center gap-1.5 text-sm font-medium text-signal">
            <CheckCircle2 size={16} aria-hidden="true" /> You&apos;re checked in
          </p>
        ) : isOpen && event.closesAt ? (
          <p className="text-sm text-muted">
            Closes in <Countdown to={event.closesAt} className="font-semibold text-ink" />
          </p>
        ) : event.opensAt ? (
          <p className="text-sm text-muted">Opens {formatDateTime(event.opensAt)}</p>
        ) : null}
      </Card>
    </Link>
  );
}

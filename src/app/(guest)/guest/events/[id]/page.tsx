import { Clock } from "lucide-react";
import { notFound } from "next/navigation";
import GuestEventForm from "@/components/GuestEventForm";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { formatDate, formatDateTime } from "@/lib/format";
import { requireGuestPass } from "@/lib/guest-pass";
import { isOpen } from "@/lib/points";
import { getEvent, getFormFields } from "@/lib/repo";

export default async function GuestEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await requireGuestPass();
  const { id } = await params;
  const event = await getEvent(orgId, id);
  // EBOARD_ONLY events never show here — no role to check for a guest, the route simply doesn't apply.
  if (!event || event.status !== "scheduled" || event.audience === "eboard_only") notFound();

  const now = new Date();
  const open = isOpen(event, now);
  const fields = await getFormFields(orgId, event.eventId);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{event.name}</h1>
        <p className="text-sm text-muted">
          {event.category.name} · {formatDate(event.date)} · {event.location || "Location TBD"}
        </p>
      </div>

      {open ? (
        <GuestEventForm eventId={event.eventId} extraFields={fields} />
      ) : (
        <EmptyState
          icon={Clock}
          title={event.opensAt && event.opensAt.getTime() > now.getTime() ? "Not open yet" : "Registration closed"}
          description={
            event.opensAt && event.opensAt.getTime() > now.getTime() ? (
              <>Opens {formatDateTime(event.opensAt)}.</>
            ) : (
              <>This event closed{event.closesAt ? ` ${formatDateTime(event.closesAt)}` : ""}.</>
            )
          }
          action={<Badge tone="muted">{event.opensAt && event.opensAt.getTime() > now.getTime() ? "Scheduled" : "Closed"}</Badge>}
        />
      )}
    </main>
  );
}

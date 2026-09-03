import { notFound } from "next/navigation";
import { updateEventAction } from "@/app/(member)/admin/events/actions";
import EventForm from "@/components/admin/EventForm";
import { getConfigValue, getEvent, getEventCategories, getEventGroups } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireEboard();
  const { id } = await params;
  const [event, categories, groups, defaultDuration] = await Promise.all([
    getEvent(session.user.orgId, id),
    getEventCategories(session.user.orgId),
    getEventGroups(session.user.orgId),
    getConfigValue(session.user.orgId, "DEFAULT_EVENT_DURATION", "20"),
  ]);
  if (!event) notFound();

  const action = updateEventAction.bind(null, event.eventId);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Edit {event.name}</h1>
      <EventForm
        action={action}
        event={event}
        categories={categories}
        groups={groups}
        submitLabel="Save changes"
        defaultDurationMinutes={Number(defaultDuration)}
      />
    </main>
  );
}

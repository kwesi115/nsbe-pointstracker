import { createEventAction } from "@/app/(member)/admin/events/actions";
import EventForm from "@/components/admin/EventForm";
import { getConfigValue, getEventCategories, getEventGroups } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export default async function NewEventPage() {
  const session = await requireEboard();
  const [categories, groups, defaultDuration] = await Promise.all([
    getEventCategories(session.user.orgId),
    getEventGroups(session.user.orgId),
    getConfigValue(session.user.orgId, "DEFAULT_EVENT_DURATION", "20"),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">New event</h1>
      <EventForm
        action={createEventAction}
        categories={categories}
        groups={groups}
        submitLabel="Create event"
        defaultDurationMinutes={Number(defaultDuration)}
      />
    </main>
  );
}

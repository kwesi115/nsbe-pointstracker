import { notFound } from "next/navigation";
import CoreFormPreview from "@/components/admin/CoreFormPreview";
import FormBuilder from "@/components/admin/FormBuilder";
import { getConfigValue, getEvent, getEvents, getFormFields, hasEventResponses } from "@/lib/repo";
import { requireEboard } from "@/lib/session";

export default async function EventQuestionsPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireEboard();
  const orgId = session.user.orgId;
  const { id } = await params;
  const event = await getEvent(orgId, id);
  if (!event) notFound();

  const [fields, locked, allEvents, maxExtraQuestionsRaw] = await Promise.all([
    getFormFields(orgId, event.eventId),
    hasEventResponses(orgId, event.eventId),
    getEvents(orgId),
    getConfigValue(orgId, "MAX_EXTRA_QUESTIONS", "5"),
  ]);
  const maxExtraQuestions = Math.max(0, Math.min(5, Number(maxExtraQuestionsRaw) || 5));
  const otherEvents = allEvents
    .filter((e) => e.eventId !== event.eventId)
    .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))
    .map((e) => ({ eventId: e.eventId, name: e.name }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Additional questions — {event.name}</h1>
        <p className="text-sm text-muted">
          Every event asks the core check-in form first. Add up to {maxExtraQuestions} questions specific to this
          event below.
        </p>
      </div>
      <CoreFormPreview />
      <FormBuilder
        eventId={event.eventId}
        initialFields={fields}
        locked={locked}
        otherEvents={otherEvents}
        maxQuestions={maxExtraQuestions}
      />
    </main>
  );
}

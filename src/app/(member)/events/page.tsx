import { CalendarClock } from "lucide-react";
import { redirect } from "next/navigation";
import EventCard from "@/components/events/EventCard";
import EmptyState from "@/components/ui/EmptyState";
import { closedRecently, isEboardOrAdmin, isOpen } from "@/lib/points";
import { getEvents, getMemberHistory } from "@/lib/repo";
import { requireSession } from "@/lib/session";

export default async function EventsPage() {
  const session = await requireSession();
  // Middleware already redirects on the cheap token read — this re-checks
  // the fresh session-callback value in case the JWT is momentarily stale.
  if (session.user.status !== "active") redirect("/pending");
  const email = session.user.email;
  const orgId = session.user.orgId;
  const now = new Date();

  // getMemberHistory is a single query filtered to this user (via the
  // Registration_userId_idx) — not the whole chapter's attendance log.
  const [events, history] = await Promise.all([getEvents(orgId), getMemberHistory(orgId, email)]);
  // EBOARD_ONLY events never appear in a GENERAL member's feed — see Part 1/5.
  const canSeeEboardOnly = isEboardOrAdmin(session.user.role);
  const scheduled = events.filter((e) => e.status === "scheduled" && (e.audience === "all" || canSeeEboardOnly));
  const registeredIds = new Set(history.map((a) => a.eventId));

  const open = scheduled.filter((e) => isOpen(e, now));
  const upcoming = scheduled
    .filter((e) => !isOpen(e, now) && e.opensAt && e.opensAt.getTime() > now.getTime())
    .sort((a, b) => (a.opensAt?.getTime() ?? 0) - (b.opensAt?.getTime() ?? 0));
  const recentlyClosed = scheduled
    .filter((e) => closedRecently(e, now))
    .sort((a, b) => (b.closesAt?.getTime() ?? 0) - (a.closesAt?.getTime() ?? 0));

  const nothing = open.length === 0 && upcoming.length === 0 && recentlyClosed.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Events</h1>

      {nothing ? (
        <EmptyState
          icon={CalendarClock}
          title="No events are open right now."
          description="Registration opens when an E-Board member starts it at the event."
        />
      ) : (
        <>
          {open.length > 0 ? (
            <Section title="Open now">
              {open.map((e) => (
                <EventCard key={e.eventId} event={e} isOpen registered={registeredIds.has(e.eventId)} />
              ))}
            </Section>
          ) : null}

          {upcoming.length > 0 ? (
            <Section title="Upcoming">
              {upcoming.map((e) => (
                <EventCard key={e.eventId} event={e} isOpen={false} registered={registeredIds.has(e.eventId)} />
              ))}
            </Section>
          ) : null}

          {recentlyClosed.length > 0 ? (
            <Section title="Recently closed">
              {recentlyClosed.map((e) => (
                <EventCard key={e.eventId} event={e} isOpen={false} registered={registeredIds.has(e.eventId)} />
              ))}
            </Section>
          ) : null}
        </>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{title}</h2>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

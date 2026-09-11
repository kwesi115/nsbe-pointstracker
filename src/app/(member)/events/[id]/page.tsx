import { CheckCircle2, Clock } from "lucide-react";
import { forbidden, notFound, redirect } from "next/navigation";
import Link from "next/link";
import CheckInFlow from "@/components/events/CheckInFlow";
import Badge from "@/components/ui/Badge";
import Countdown from "@/components/Countdown";
import EmptyState from "@/components/ui/EmptyState";
import { formatDate, formatDateTime } from "@/lib/format";
import { hasRegistered, isEboardOrAdmin, isOpen } from "@/lib/points";
import { getAttendanceForEvent, getCoreFormUiConfig, getEvent, getFormFields, getMember } from "@/lib/repo";
import { requireSession } from "@/lib/session";

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  if (session.user.status !== "active") redirect("/pending");

  const orgId = session.user.orgId;
  const event = await getEvent(orgId, id);
  if (!event || event.status !== "scheduled") notFound();

  // A real 403 (next/navigation's forbidden(), see next.config.ts
  // authInterrupts) — not merely hidden from the feed. registerForEvent has
  // the same check server-side as defense in depth.
  if (event.audience === "eboard_only" && !isEboardOrAdmin(session.user.role)) {
    forbidden();
  }

  const now = new Date();
  const open = isOpen(event, now);
  const [fields, attendance, member, coreFormConfig] = await Promise.all([
    getFormFields(orgId, event.eventId),
    getAttendanceForEvent(orgId, event.eventId),
    getMember(orgId, session.user.email),
    getCoreFormUiConfig(orgId),
  ]);
  const registered = hasRegistered(attendance, event.eventId, session.user.email);

  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 py-4 md:gap-6 md:px-6 md:py-10">
      <div>
        <Link href="/events" className="text-sm text-muted hover:text-ink">
          ← Events
        </Link>
        <h1 className="mt-1 font-display text-xl font-bold text-ink md:text-2xl">{event.name}</h1>
        <p className="text-sm text-muted">
          {event.category.shortName} · +{event.points ?? event.category.memberPoints} · {formatDate(event.date)} ·{" "}
          {event.location || "Location TBD"}
        </p>
      </div>

      {registered ? (
        <EmptyState
          icon={CheckCircle2}
          title="You're checked in"
          description="This event has already been logged for you."
        />
      ) : open ? (
        <>
          {event.closesAt ? (
            <p className="flex items-center gap-1.5 text-sm text-muted">
              <Clock size={16} aria-hidden="true" />
              Closes in <Countdown to={event.closesAt} className="font-semibold text-ink" />
            </p>
          ) : null}
          <CheckInFlow
            eventId={event.eventId}
            extraFields={fields}
            reduced={event.audience === "eboard_only"}
            member={
              member ?? {
                // No roster row at all — the most restrictive fallback is
                // a plain member, so nothing is skipped on their behalf.
                role: "general",
                firstName: "",
                lastName: "",
                studentId: "",
                phone: "",
                personalEmail: "",
                tshirtSize: "",
                classification: "",
                major: "",
                majorOther: "",
                profileSeason: "",
                nsbeMembershipId: "",
                house: "",
                houseVerifiedAt: null,
                resumeFileId: null,
                duesPaidReported: null,
                nationalMemberReported: null,
                membershipSeason: "",
              }
            }
            email={session.user.email}
            coreFormConfig={coreFormConfig}
          />
        </>
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

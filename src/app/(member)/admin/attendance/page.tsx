import { Download } from "lucide-react";
import AccessDenied from "../_components/AccessDenied";
import AddAttendeeDialog from "@/components/admin/AddAttendeeDialog";
import AdminNav from "@/components/admin/AdminNav";
import AttendanceDirectory from "@/components/admin/AttendanceDirectory";
import AttendeeTable from "@/components/admin/AttendeeTable";
import Card from "@/components/ui/Card";
import { isAllowed } from "@/lib/access";
import { guardAdminPage } from "@/lib/access-guards";
import { formatDate } from "@/lib/format";
import {
  getEventAttendees,
  getEventAttendanceSummaries,
  getEventCategories,
  type EventAttendanceSummary,
} from "@/lib/repo";
import { seasonOf, seasonsPresent } from "@/lib/season";

interface AttendanceSearchParams {
  event?: string;
  season?: string;
  category?: string;
  from?: string;
  to?: string;
  q?: string;
}

/** Parses a yyyy-mm-dd filter box. Anything unparseable filters nothing, rather than silently matching nothing. */
function asDate(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export default async function AdminAttendancePage({
  searchParams,
}: {
  searchParams: Promise<AttendanceSearchParams>;
}) {
  // Reading the directory is plain E-Board access. Changing what it says is
  // not — see the attendance_write check below.
  const guard = await guardAdminPage({ level: "eboard" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const orgId = session.user.orgId;
  const params = await searchParams;

  const canWrite = isAllowed(guard.access, { level: "permission", permission: "attendance_write" });

  const [summaries, categories] = await Promise.all([getEventAttendanceSummaries(orgId), getEventCategories(orgId)]);
  const seasons = seasonsPresent(summaries.map((s: EventAttendanceSummary) => s.date ?? s.closesAt));

  // Default to the current season — an officer in April wants this term, not
  // every event the chapter has ever run.
  const requestedSeason = params.season ?? seasonOf(new Date());
  const season = requestedSeason === "all" || seasons.includes(requestedSeason) ? requestedSeason : "all";
  const category = params.category ?? "all";
  const from = asDate(params.from);
  const to = asDate(params.to);
  const q = (params.q ?? "").trim().toLowerCase();

  const events = summaries.filter((e: EventAttendanceSummary) => {
    const when = e.date ?? e.closesAt;
    if (season !== "all" && (!when || seasonOf(when) !== season)) return false;
    if (category !== "all" && e.categoryName !== category) {
      const match = categories.find((c) => c.id === category);
      if (!match || match.name !== e.categoryName) return false;
    }
    if (from && (!when || when.getTime() < from.getTime())) return false;
    // `to` is inclusive of the whole day the officer picked.
    if (to && (!when || when.getTime() > to.getTime() + 24 * 60 * 60 * 1000 - 1)) return false;
    if (q && !e.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const selected =
    params.event && events.some((e: EventAttendanceSummary) => e.eventId === params.event) ? params.event : null;
  const selectedEvent = selected ? events.find((e: EventAttendanceSummary) => e.eventId === selected)! : null;
  const initialPage = selected ? await getEventAttendees(orgId, selected) : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Attendance</h1>
        <p className="text-sm text-muted">
          {canWrite
            ? "Open an event to see who attended, correct points, or add someone who missed check-in."
            : "Open an event to see who attended. Ask an admin for the Attendance editing permission to make changes."}
        </p>
      </div>
      <AdminNav active="/admin/attendance" access={guard.access} />

      <AttendanceDirectory
        events={events}
        seasons={seasons}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        filters={{ season, category, from: params.from ?? "", to: params.to ?? "", q: params.q ?? "" }}
        selectedId={selected}
      >
        {selectedEvent && initialPage ? (
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-display text-lg font-bold text-ink">{selectedEvent.name}</h2>
                <p className="text-sm text-muted">
                  {selectedEvent.date ? formatDate(selectedEvent.date) : "No date"} · {selectedEvent.categoryName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Same EXPORTS_ENABLED flag as every other export surface. */}
                {guard.access.features.exports ? (
                  <a
                    href={`/api/admin/export/event/${selectedEvent.eventId}/csv`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
                  >
                    <Download size={16} aria-hidden="true" /> Export CSV
                  </a>
                ) : null}
                {canWrite ? (
                  <AddAttendeeDialog eventId={selectedEvent.eventId} eventName={selectedEvent.name} />
                ) : null}
              </div>
            </div>

            <AttendeeTable
              key={selectedEvent.eventId}
              eventId={selectedEvent.eventId}
              initialPage={initialPage}
              canWrite={canWrite}
            />
          </Card>
        ) : null}
      </AttendanceDirectory>
    </main>
  );
}

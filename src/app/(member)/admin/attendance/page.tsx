import { guardAdminPage } from "@/lib/access-guards";
import AccessDenied from "../_components/AccessDenied";
import AdminNav from "@/components/admin/AdminNav";
import AttendanceManager, { type AttendanceRow } from "@/components/admin/AttendanceManager";
import { memberDisplayName } from "@/lib/format";
import { getAttendance, getEvents, getMembers } from "@/lib/repo";

export default async function AdminAttendancePage() {
  const guard = await guardAdminPage({ level: "eboard" });
  if (!guard.ok) return <AccessDenied denied={guard} />;
  const session = guard.session;
  const orgId = session.user.orgId;
  const [attendance, events, members] = await Promise.all([getAttendance(orgId), getEvents(orgId), getMembers(orgId)]);

  const eventById = new Map(events.map((e) => [e.eventId, e]));
  const memberByEmail = new Map(members.map((m) => [m.email, m]));

  const rows: AttendanceRow[] = attendance
    .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0))
    .map((a) => {
      const member = memberByEmail.get(a.email);
      return {
        id: a.id,
        timestamp: a.timestamp ? a.timestamp.toISOString() : null,
        eventName: eventById.get(a.eventId)?.name ?? a.eventId,
        name: member ? memberDisplayName(member.firstName, member.lastName, member.email) : a.email,
        email: a.email,
        points: a.pointsAwarded,
        source: a.source,
        note: a.note,
      };
    });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Attendance</h1>
      <AdminNav active="/admin/attendance" access={guard.access} />
      <AttendanceManager
        rows={rows}
        events={events.map((e) => ({ eventId: e.eventId, name: e.name }))}
        members={members.map((m) => ({ email: m.email, name: memberDisplayName(m.firstName, m.lastName, m.email) }))}
      />
    </main>
  );
}

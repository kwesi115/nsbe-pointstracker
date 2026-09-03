import { notFound } from "next/navigation";
import AdminHousePanel from "@/components/admin/AdminHousePanel";
import AdminMembershipPanel from "@/components/admin/AdminMembershipPanel";
import AdminNav from "@/components/admin/AdminNav";
import AdminProfilePanel from "@/components/admin/AdminProfilePanel";
import RoleSelect from "@/components/admin/RoleSelect";
import Badge from "@/components/ui/Badge";
import PointsChart, { type PointsChartPoint } from "@/components/dashboard/PointsChart";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { formatDate, formatDateTime, memberDisplayName } from "@/lib/format";
import { attendanceRate, isEligible, longestAttendanceStreak } from "@/lib/points";
import { getAdminLog, getConfigValue, getCoreFormConfig, getEvents, getMemberById, getMemberHistory } from "@/lib/repo";
import { requireAdminForbidden } from "@/lib/session";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminForbidden();
  const orgId = session.user.orgId;
  const { id } = await params;

  const member = await getMemberById(orgId, id);
  if (!member) notFound();

  const [history, events, adminLog, season, coreFormConfig] = await Promise.all([
    getMemberHistory(orgId, member.email),
    getEvents(orgId),
    getAdminLog(orgId),
    getConfigValue(orgId, "SEASON", ""),
    getCoreFormConfig(orgId),
  ]);

  const eventById = new Map(events.map((e) => [e.eventId, e]));
  const eligible = isEligible(member, season);
  const houseState: "none" | "pending" | "verified" = member.houseVerifiedAt ? "verified" : member.house ? "pending" : "none";

  // A GENERAL member could never have attended an EBOARD_ONLY event — exclude
  // it from the denominator so it doesn't drag their attendance rate down.
  const visibleEvents = member.role === "eboard" ? events : events.filter((e) => e.audience === "all");
  const rate = attendanceRate(history, visibleEvents, member.joinedAt);
  const eligibleChronological = visibleEvents
    .filter((e) => e.openedAt !== null && (e.closesAt === null || member.joinedAt === null || e.closesAt >= member.joinedAt))
    .sort((a, b) => (a.openedAt?.getTime() ?? 0) - (b.openedAt?.getTime() ?? 0));
  const attendedIds = new Set(history.map((r) => r.eventId));
  const streak = longestAttendanceStreak(eligibleChronological, attendedIds);
  const now = new Date();
  const daysSinceLastAttended = history[0]?.timestamp ? Math.floor((now.getTime() - history[0].timestamp.getTime()) / DAY_MS) : null;

  const categoryBreakdown = new Map<string, { points: number; events: number }>();
  for (const row of history) {
    const type = eventById.get(row.eventId)?.category.shortName ?? "Unknown";
    const entry = categoryBreakdown.get(type) ?? { points: 0, events: 0 };
    entry.points += row.pointsAwarded;
    entry.events += 1;
    categoryBreakdown.set(type, entry);
  }

  const chartData: PointsChartPoint[] = [];
  let running = 0;
  for (const row of [...history].reverse()) {
    running += row.pointsAwarded;
    chartData.push({ date: (row.timestamp ?? new Date()).toISOString(), points: running });
  }

  const memberLog = adminLog.filter((l) => l.target.trim().toLowerCase() === member.email.toLowerCase());

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-bold text-ink">
            {memberDisplayName(member.firstName, member.lastName, member.email)}
          </h1>
          <Badge tone={eligible ? "signal" : "muted"}>{eligible ? "Eligible" : "Ineligible"}</Badge>
        </div>
        <p className="text-sm text-muted">
          {member.email} · {season || "no season set"}
        </p>
      </div>
      <AdminNav active="/admin/members" />

      <section className="flex flex-wrap items-center gap-3">
        <RoleSelect email={member.email} role={member.role} />
        <span className="text-sm text-muted">joined {formatDate(member.joinedAt)}</span>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Profile</h2>
        <AdminProfilePanel member={member} majors={coreFormConfig.majors} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Membership</h2>
        <AdminMembershipPanel member={member} season={season} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">House</h2>
        <AdminHousePanel member={{ ...member, houseState }} houses={coreFormConfig.houses} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Resume</h2>
        {member.resumeFileId ? (
          <div className="flex flex-col gap-1 text-sm">
            <a href={`/api/files/${member.resumeFileId}`} target="_blank" rel="noopener noreferrer" className="font-medium text-signal underline underline-offset-2">
              View resume
            </a>
            <p className="text-xs text-muted">
              Uploaded {formatDateTime(member.resumeUpdatedAt)}
              {member.resumeConsentAt ? ` · consent given ${formatDateTime(member.resumeConsentAt)}` : ""}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">No resume on file.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Insights</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Attendance rate</p>
            <p className="numeric text-xl font-semibold text-ink">
              {rate.eligible > 0 ? `${rate.attended}/${rate.eligible}` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Longest streak</p>
            <p className="numeric text-xl font-semibold text-ink">{streak}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Days since last attended</p>
            <p className="numeric text-xl font-semibold text-ink">{daysSinceLastAttended ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-xs text-muted">Total events</p>
            <p className="numeric text-xl font-semibold text-ink">{history.length}</p>
          </div>
        </div>
        {chartData.length > 0 ? <PointsChart data={chartData} /> : null}
        {categoryBreakdown.size > 0 ? (
          <Table>
            <Thead>
              <th className={thClass}>Category</th>
              <th className={thClass}>Points</th>
              <th className={thClass}>Events</th>
            </Thead>
            <tbody>
              {Array.from(categoryBreakdown.entries()).map(([type, stats]) => (
                <tr key={type} className="border-b border-line last:border-0">
                  <td className={tdClass}>{type}</td>
                  <td className={`${tdClass} numeric`}>{stats.points}</td>
                  <td className={`${tdClass} numeric`}>{stats.events}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Activity</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">No registrations yet.</p>
        ) : (
          <Table>
            <Thead>
              <th className={thClass}>Event</th>
              <th className={thClass}>Date</th>
              <th className={thClass}>Type</th>
              <th className={thClass}>Points</th>
              <th className={thClass}>Source</th>
            </Thead>
            <tbody>
              {history.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className={tdClass}>{eventById.get(row.eventId)?.name ?? row.eventId}</td>
                  <td className={tdClass}>{formatDate(row.timestamp)}</td>
                  <td className={tdClass}>{eventById.get(row.eventId)?.category.shortName ?? "—"}</td>
                  <td className={`${tdClass} numeric`}>{row.pointsAwarded}</td>
                  <td className={tdClass}>{row.source === "manual" ? <Badge tone="amber">Manual</Badge> : "Form"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Audit</h2>
        {memberLog.length === 0 ? (
          <p className="text-sm text-muted">No admin actions recorded for this member.</p>
        ) : (
          <Table>
            <Thead>
              <th className={thClass}>Timestamp</th>
              <th className={thClass}>Actor</th>
              <th className={thClass}>Action</th>
              <th className={thClass}>Detail</th>
            </Thead>
            <tbody>
              {memberLog.map((entry, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className={tdClass}>{formatDateTime(entry.timestamp)}</td>
                  <td className={tdClass}>{entry.actor}</td>
                  <td className={tdClass}>{entry.action}</td>
                  <td className={tdClass}>{entry.detail || "—"}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </main>
  );
}

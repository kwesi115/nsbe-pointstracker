import { Download } from "lucide-react";
import AdminNav from "@/components/admin/AdminNav";
import Badge from "@/components/ui/Badge";
import { inputClass, selectClass } from "@/components/ui/Field";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { getEboardBoardRows, type EboardCategory } from "@/lib/repo";
import { requireEboardForbidden } from "@/lib/session";

const CATEGORY_LABEL: Record<EboardCategory, string> = {
  chapter: "Chapter events",
  eboardMeetings: "E-Board meetings",
  retreats: "Retreats",
};

function rate(attended: number, eligible: number): string {
  return eligible > 0 ? `${attended}/${eligible}` : "—";
}

export default async function AdminLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; category?: string }>;
}) {
  // A real 403 for below-EBOARD (next/navigation forbidden(), see next.config.ts
  // authInterrupts) — not merely un-linked from member-facing nav.
  const session = await requireEboardForbidden();

  const { from, to, category } = await searchParams;
  const validCategory: EboardCategory | undefined =
    category === "chapter" || category === "eboardMeetings" || category === "retreats" ? category : undefined;

  const rows = await getEboardBoardRows(session.user.orgId, {
    from: from ? new Date(from) : undefined,
    to: to ? new Date(`${to}T23:59:59`) : undefined,
    category: validCategory,
  });

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold text-ink">E-Board Leaderboard</h1>
          <Badge tone="amber">E-Board internal</Badge>
        </div>
        <p className="text-sm text-muted">
          The internal accountability track — visible to E-Board only. A raw total tells you someone has 14; the
          split tells you they&apos;ve made every GBM and skipped every meeting.
        </p>
      </div>
      <AdminNav active="/admin/leaderboard" />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          From
          <input type="date" name="from" defaultValue={from} className={`${inputClass} w-40`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          To
          <input type="date" name="to" defaultValue={to} className={`${inputClass} w-40`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Category
          <select name="category" defaultValue={validCategory ?? ""} className={`${selectClass} w-44`}>
            <option value="">All categories</option>
            <option value="chapter">Chapter events</option>
            <option value="eboardMeetings">E-Board meetings</option>
            <option value="retreats">Retreats</option>
          </select>
        </label>
        <button type="submit" className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-sunken">
          Apply
        </button>
        <a
          href="/api/admin/export/eboard-leaderboard/csv"
          className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-semibold text-ink hover:bg-surface-sunken"
        >
          <Download size={16} aria-hidden="true" /> Export CSV
        </a>
      </form>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-surface px-4 py-6 text-center text-sm text-muted">
          No E-Board members match this filter.
        </p>
      ) : (
        <Table>
          <Thead>
            <th className={thClass}>Rank</th>
            <th className={thClass}>Name</th>
            <th className={thClass}>Position</th>
            <th className={thClass}>Total</th>
            <th className={thClass}>Events</th>
            <th className={thClass}>{CATEGORY_LABEL.chapter}</th>
            <th className={thClass}>{CATEGORY_LABEL.eboardMeetings}</th>
            <th className={thClass}>{CATEGORY_LABEL.retreats}</th>
          </Thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.email} className="border-b border-line last:border-0">
                <td className={`${tdClass} numeric`}>#{r.rank}</td>
                <td className={tdClass}>
                  {r.firstName} {r.lastName}
                  <span className="block text-xs text-muted">{r.email}</span>
                </td>
                <td className={tdClass}>{r.eboardPosition || "—"}</td>
                <td className={`${tdClass} numeric font-semibold`}>{r.points}</td>
                <td className={`${tdClass} numeric`}>{r.events}</td>
                <td className={`${tdClass} numeric`}>
                  {r.chapter.points} pts · {rate(r.chapter.attended, r.chapter.eligible)}
                </td>
                <td className={`${tdClass} numeric`}>
                  {r.eboardMeetings.points} pts · {rate(r.eboardMeetings.attended, r.eboardMeetings.eligible)}
                </td>
                <td className={`${tdClass} numeric`}>
                  {r.retreats.points} pts · {rate(r.retreats.attended, r.retreats.eligible)}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </main>
  );
}

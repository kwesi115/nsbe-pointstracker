import { CalendarClock } from "lucide-react";
import Link from "next/link";
import PointsChart, { type PointsChartPoint } from "@/components/dashboard/PointsChart";
import MembershipRequiredPanel from "@/components/dashboard/MembershipRequiredPanel";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import StatTile from "@/components/ui/StatTile";
import Table, { tdClass, thClass, Thead } from "@/components/ui/Table";
import { formatDate } from "@/lib/format";
import { eboardAwardFor, isEligible, memberPointsFor } from "@/lib/points";
import {
  getActiveNsbeWeekProgress,
  getConfigValue,
  getEboardBoardRows,
  getEboardScoringConfig,
  getEvents,
  getMember,
  getMemberBreakdown,
  getMemberHistory,
  getMemberSummaryLive,
  getPointAwardsForUser,
  type NsbeWeekProgress,
} from "@/lib/repo";
import { getCachedStandings } from "@/lib/standings-cache";

import { requireSession } from "@/lib/session";
import type { BonusTier, PointBreakdown } from "@/lib/types";

/** "+3 bonus at 3, +5 at 5" — the exact copy the check-in-drive progress line reads out. */
function describeBonusTiers(tiers: BonusTier[]): string {
  return [...tiers]
    .sort((a, b) => a.min - b.min)
    .map((t, i) => `+${t.bonus} ${i === 0 ? "bonus " : ""}at ${t.min}`)
    .join(", ");
}

function NsbeWeekBanner({ progress }: { progress: NsbeWeekProgress }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-amber bg-amber/10 px-4 py-3">
      <p className="text-sm font-semibold text-ink">{progress.groupName}</p>
      <p className="text-sm text-ink">
        {progress.attended} of {progress.expectedEventCount} attended · {describeBonusTiers(progress.bonusTiers)} bonus
      </p>
    </div>
  );
}

/** Zero-value lines are hidden — except NSBE Week during an active (incomplete) group, which shows progress instead of a number that would otherwise misleadingly read 0. */
function BreakdownCard({ breakdown }: { breakdown: PointBreakdown }) {
  const rows: Array<{ label: string; value: number }> = [
    { label: "Event points", value: breakdown.eventPoints },
    { label: "NSBE Week bonus", value: breakdown.nsbeWeekBonus },
    { label: "Game bonuses", value: breakdown.gameBonus },
    { label: "Monthly champion", value: breakdown.monthlyChampionBonus },
    { label: "Manual bonus", value: breakdown.manualBonus },
  ].filter((r) => r.value !== 0);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Point breakdown</h2>
      <Card>
        <dl className="flex flex-col gap-2 text-sm">
          {rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between">
              <dt className="text-ink">{r.label}</dt>
              <dd className="numeric font-medium text-ink">{r.value}</dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2">
            <dt className="font-semibold text-ink">Season total</dt>
            <dd className="numeric text-lg font-bold text-signal">{breakdown.total}</dd>
          </div>
        </dl>
      </Card>
    </section>
  );
}

export default async function DashboardPage() {
  const session = await requireSession();
  const email = session.user.email;
  const orgId = session.user.orgId;

  if (session.user.role === "eboard" || session.user.role === "admin") {
    return <EboardDashboard orgId={orgId} email={email} />;
  }

  // The board (everyone else's rank context) comes from the 30s-revalidating
  // standings cache — cheap even with 80 members hitting it inside one GBM.
  // This member's OWN row is never read from that cache: getMemberSummaryLive
  // computes it fresh, every time, so a check-in's points show up instantly
  // instead of waiting out the cache window (see lib/standings-cache.ts and
  // lib/repo.ts getMemberSummaryLive). history.length (not summary.events) is
  // used below for "Events attended" since that must reflect real attendance
  // either way.
  const season = await getConfigValue(orgId, "SEASON", "");
  const [history, cachedStandings, events, member, showPendingPoints, breakdown, awards, nsbeWeekProgress] = await Promise.all([
    getMemberHistory(orgId, email),
    getCachedStandings(orgId, season),
    getEvents(orgId),
    getMember(orgId, email),
    getConfigValue(orgId, "SHOW_PENDING_POINTS", "false"),
    getMemberBreakdown(orgId, email),
    getPointAwardsForUser(orgId, email),
    getActiveNsbeWeekProgress(orgId, email),
  ]);
  const summary = await getMemberSummaryLive(orgId, email, season, cachedStandings);
  const eventById = new Map(events.map((e) => [e.eventId, e]));
  const eligible = member ? isEligible(member, season) : false;
  const pendingPoints = history.reduce((sum, row) => sum + row.pointsAwarded, 0);

  const better = cachedStandings.filter((s) => s.email.toLowerCase() !== email.toLowerCase() && s.points > summary.points);
  const pointsBehind = better.length > 0 ? Math.min(...better.map((s) => s.points)) - summary.points : null;

  // The chart's timeline merges two sources: regular check-ins (re-derived
  // live from each row's category/override, exactly like the leaderboard —
  // never the frozen pointsAwarded) and bonus awards, each landing at its own
  // awardedAt so a +5 jump shows up exactly when it was granted, not
  // backdated to a check-in.
  const activeAwards = awards.filter((a) => a.revokedAt === null);
  const timeline = [
    ...history.map((row) => ({
      date: row.timestamp ?? new Date(),
      points: memberPointsFor({ role: "general" }, { points: row.eventPointsOverride }, row.category),
      isBonus: false,
    })),
    ...activeAwards.map((a) => ({ date: a.awardedAt ?? new Date(), points: a.points, isBonus: true })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  const chartData: PointsChartPoint[] = [];
  let running = 0;
  for (const entry of timeline) {
    running += entry.points;
    chartData.push({ date: entry.date.toISOString(), points: running, isBonus: entry.isBonus });
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Dashboard</h1>

      {/* The single best attendance driver in the system — kept prominent, above the fold, during an active week. */}
      {nsbeWeekProgress ? <NsbeWeekBanner progress={nsbeWeekProgress} /> : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {eligible ? (
          <>
            <StatTile label="Season points" value={summary.points} accent="signal" />
            <StatTile label="Rank" value={summary.rank ? `#${summary.rank}` : "—"} sub={summary.rank ? `of ${summary.totalRanked}` : undefined} />
            <StatTile label="Events attended" value={history.length} />
            {pointsBehind !== null ? (
              <StatTile label="Behind next rank" value={pointsBehind} accent="amber" />
            ) : summary.rank === 1 ? (
              <StatTile label="Standing" value="Leading" accent="amber" size="md" />
            ) : (
              <StatTile label="Behind next rank" value="—" />
            )}
          </>
        ) : (
          <StatTile label="Events attended" value={history.length} />
        )}
      </div>

      {!eligible && history.length > 0 ? (
        <MembershipRequiredPanel member={member} pendingPoints={showPendingPoints === "true" ? pendingPoints : null} />
      ) : null}

      {history.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No events yet"
          description="Check in at your first event to start earning points — every General Body Meeting, workshop, or service event on the calendar counts. Points are only awarded to General members."
          action={
            <Link href="/events" className="text-sm font-semibold text-signal underline underline-offset-2">
              Browse events
            </Link>
          }
        />
      ) : (
        <>
          {eligible ? (
            <>
              <BreakdownCard breakdown={breakdown} />
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Points over time</h2>
                <PointsChart data={chartData} />
              </section>
            </>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Attendance history</h2>
            <Table>
              <Thead>
                <th className={thClass}>Event</th>
                <th className={thClass}>Date</th>
                <th className={thClass}>Category</th>
                <th className={thClass}>Points</th>
                <th className={thClass}></th>
              </Thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className={tdClass}>{eventById.get(row.eventId)?.name ?? row.eventId}</td>
                    <td className={tdClass}>{formatDate(row.timestamp)}</td>
                    <td className={tdClass}>{eventById.get(row.eventId)?.category.shortName ?? "—"}</td>
                    <td className={`${tdClass} numeric`}>
                      {memberPointsFor({ role: "general" }, { points: row.eventPointsOverride }, row.category)}
                    </td>
                    <td className={tdClass}>
                      {row.source === "manual" ? <Badge tone="amber">Added by E-Board</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        </>
      )}
    </main>
  );
}

/**
 * The internal view for an EBOARD user — their own total/rank/category
 * breakdown on the SAME internal track /admin/leaderboard reads (Part 5:
 * "They can see their own standing; only admins see everyone's."). The
 * attendance table's Points column shows the per-row E-Board scoring, not
 * the raw (always-0) member pointsAwarded — otherwise every row would read
 * "0", the same "+0 looks broken" problem the check-in receipt guards
 * against, just in table form. Explicitly untouched by Part 1-3's tiers/
 * NSBE-Week bonus/game bonus/monthly champion — see lib/points.ts
 * eboardAwardFor / computeEboardStandings.
 */
async function EboardDashboard({ orgId, email }: { orgId: string; email: string }) {
  const [history, rows, events, eboardConfig] = await Promise.all([
    getMemberHistory(orgId, email),
    getEboardBoardRows(orgId),
    getEvents(orgId),
    getEboardScoringConfig(orgId),
  ]);
  const eventById = new Map(events.map((e) => [e.eventId, e]));
  const row = rows.find((r) => r.email.toLowerCase() === email.toLowerCase());
  const summary = row ?? { points: 0, rank: null, events: 0 };
  const totalRanked = rows.length;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="font-display text-2xl font-bold text-ink">Dashboard</h1>
          <Badge tone="amber">E-Board internal</Badge>
        </div>
        <p className="text-sm text-muted">Your standing on the internal E-Board track — not visible to general members.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="E-Board points" value={summary.points} accent="signal" />
        <StatTile label="Internal rank" value={summary.rank ? `#${summary.rank}` : "—"} sub={summary.rank ? `of ${totalRanked}` : undefined} />
        <StatTile label="Events attended" value={history.length} />
      </div>

      {row ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Category breakdown</h2>
          <Table>
            <Thead>
              <th className={thClass}>Category</th>
              <th className={thClass}>Points</th>
              <th className={thClass}>Attended</th>
              <th className={thClass}>Rate</th>
            </Thead>
            <tbody>
              {(
                [
                  ["Chapter events", row.chapter],
                  ["E-Board meetings", row.eboardMeetings],
                  ["Retreats", row.retreats],
                ] as const
              ).map(([label, stats]) => (
                <tr key={label} className="border-b border-line last:border-0">
                  <td className={tdClass}>{label}</td>
                  <td className={`${tdClass} numeric`}>{stats.points}</td>
                  <td className={`${tdClass} numeric`}>{stats.attended}</td>
                  <td className={`${tdClass} numeric`}>
                    {stats.eligible > 0 ? `${stats.attended}/${stats.eligible}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ) : null}

      {history.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No events yet"
          description="Check in at your first event — GBMs count toward the chapter-events category, and E-Board meetings/retreats have their own."
          action={
            <Link href="/events" className="text-sm font-semibold text-signal underline underline-offset-2">
              Browse events
            </Link>
          }
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Attendance history</h2>
          <Table>
            <Thead>
              <th className={thClass}>Event</th>
              <th className={thClass}>Date</th>
              <th className={thClass}>Category</th>
              <th className={thClass}>E-Board pts</th>
            </Thead>
            <tbody>
              {history.map((historyRow) => {
                const event = eventById.get(historyRow.eventId);
                const points = eboardAwardFor("eboard", historyRow.category, eboardConfig);
                return (
                  <tr key={historyRow.id} className="border-b border-line last:border-0">
                    <td className={tdClass}>{event?.name ?? historyRow.eventId}</td>
                    <td className={tdClass}>{formatDate(historyRow.timestamp)}</td>
                    <td className={tdClass}>{event?.category.shortName ?? "—"}</td>
                    <td className={`${tdClass} numeric`}>{points}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}
    </main>
  );
}

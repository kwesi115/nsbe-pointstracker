"use client";

import { useMemo, useState } from "react";
import { inputClass } from "@/components/ui/Field";
import EmptyState from "@/components/ui/EmptyState";
import type { PointBreakdown, Standing } from "@/lib/types";

type StandingWithBreakdown = Standing & { breakdown: PointBreakdown };

function displayName(s: Standing): string {
  const initial = s.lastName ? `${s.lastName[0]}.` : "";
  return `${s.firstName} ${initial}`.trim() || s.email;
}

/** The row-expand breakdown — deliberately not cluttering the row itself, per the spec. */
function BreakdownDetail({ breakdown }: { breakdown: PointBreakdown }) {
  const lines: Array<{ label: string; value: number }> = [
    { label: "Event points", value: breakdown.eventPoints },
    { label: "NSBE Week bonus", value: breakdown.nsbeWeekBonus },
    { label: "Game bonuses", value: breakdown.gameBonus },
    { label: "Monthly champion", value: breakdown.monthlyChampionBonus },
    { label: "Manual bonus", value: breakdown.manualBonus },
  ].filter((l) => l.value !== 0);

  if (lines.length === 0) return null;

  return (
    <dl className="ml-12 mt-1 flex flex-wrap gap-x-4 gap-y-1 pb-2 text-xs text-muted">
      {lines.map((l) => (
        <div key={l.label} className="flex items-center gap-1">
          <dt>{l.label}:</dt>
          <dd className="numeric font-medium text-ink">{l.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Row({
  s,
  leaderPoints,
  highlight,
  expanded,
  onToggle,
}: {
  s: StandingWithBreakdown;
  leaderPoints: number;
  highlight?: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const share = leaderPoints > 0 ? Math.max(0, Math.min(1, s.points / leaderPoints)) : 0;
  const top3 = s.rank <= 3;

  return (
    <div className={`rounded-lg border-l-4 ${top3 ? "border-amber" : "border-transparent"} ${highlight ? "bg-signal/5 ring-1 ring-signal/30" : ""}`}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-3 py-2.5 text-left"
        aria-expanded={expanded}
      >
        <span className="numeric w-8 shrink-0 text-right text-sm font-semibold text-muted">{s.rank}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{displayName(s)}</p>
          <div className="mt-1 h-1.5 w-full rounded-full bg-surface-sunken">
            <div className="h-1.5 rounded-full bg-signal" style={{ width: `${share * 100}%` }} />
          </div>
        </div>
        <span className="numeric w-10 shrink-0 text-right text-xs text-muted">{s.events} ev</span>
        <span className="numeric w-12 shrink-0 text-right text-base font-semibold text-ink">{s.points}</span>
      </button>
      {expanded ? <BreakdownDetail breakdown={s.breakdown} /> : null}
    </div>
  );
}

export default function LeaderboardTable({
  standings,
  currentEmail,
}: {
  standings: StandingWithBreakdown[];
  currentEmail: string;
}) {
  const [search, setSearch] = useState("");
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);
  const leaderPoints = standings[0]?.points ?? 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return standings;
    return standings.filter((s) => `${s.firstName} ${s.lastName}`.toLowerCase().includes(q));
  }, [search, standings]);

  const me = standings.find((s) => s.email === currentEmail);
  const meVisible = filtered.some((s) => s.email === currentEmail);

  if (standings.length === 0) {
    return <EmptyState title="No standings yet" description="Points appear here once members start checking in to events." />;
  }

  function toggle(email: string) {
    setExpandedEmail((prev) => (prev === email ? null : email));
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name"
        aria-label="Search the leaderboard by name"
        className={inputClass}
      />

      <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-2">
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted">No members match &ldquo;{search}&rdquo;.</p>
        ) : (
          filtered.map((s) => (
            <Row
              key={s.email}
              s={s}
              leaderPoints={leaderPoints}
              highlight={s.email === currentEmail}
              expanded={expandedEmail === s.email}
              onToggle={() => toggle(s.email)}
            />
          ))
        )}
      </div>

      {me && !meVisible ? (
        <div className="sticky bottom-2 rounded-xl border border-signal bg-surface p-2 shadow-lg">
          <Row s={me} leaderPoints={leaderPoints} highlight expanded={expandedEmail === me.email} onToggle={() => toggle(me.email)} />
        </div>
      ) : null}
    </div>
  );
}

import { Info } from "lucide-react";
import LeaderboardTable from "@/components/leaderboard/LeaderboardTable";
import { DEFAULT_LEADERBOARD_DISCLAIMER, getConfigValue } from "@/lib/repo";
import { getCachedStandingsWithBreakdowns } from "@/lib/standings-cache";
import { requireSession } from "@/lib/session";

export default async function LeaderboardPage() {
  const session = await requireSession();
  const season = await getConfigValue(session.user.orgId, "SEASON", "");
  const [standings, disclaimer] = await Promise.all([
    getCachedStandingsWithBreakdowns(session.user.orgId, season),
    getConfigValue(session.user.orgId, "LEADERBOARD_DISCLAIMER", DEFAULT_LEADERBOARD_DISCLAIMER),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="font-display text-2xl font-bold text-ink">Leaderboard</h1>
      {/* Persistent, quiet informational panel — never dismissible, never the alert color (this is context, not a warning). See /admin/settings to edit the wording. */}
      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-muted/10 px-4 py-3 text-sm text-ink">
        <Info size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden="true" />
        <p>{disclaimer}</p>
      </div>
      <LeaderboardTable standings={standings} currentEmail={session.user.email} />
    </main>
  );
}

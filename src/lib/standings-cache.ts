/**
 * Request-deduped, time-bounded cache in front of the standings board.
 * computeStandings (lib/points.ts) itself is cheap in query count (5 fixed
 * queries regardless of org size — see lib/repo.ts getStandingsForSeason),
 * but at GBM scale (dozens of members hitting the leaderboard/dashboard
 * within minutes of each other) it's still a full org-wide re-aggregation on
 * every request. A 30s revalidate window means concurrent viewers share one
 * computation, while a write (registration, award, role/eligibility change,
 * category edit — see lib/repo.ts's invalidateStandings call sites)
 * invalidates immediately via revalidateTag, so the window never shows
 * meaningfully stale data after an actual change.
 *
 * Deliberately NOT used by:
 *   - lib/repo.ts's registerForEvent / getMemberSummary — that path must
 *     read live data (see registerForEvent's own comment).
 *   - the dashboard's OWN-member row — see lib/repo.ts getMemberSummaryLive,
 *     which reads this cache for everyone else's rank context but computes
 *     the caller's own total fresh, every time.
 */

import { unstable_cache } from "next/cache";
import { getStandingsForSeason, getStandingsWithBreakdownsForSeason } from "./repo";
import { standingsCacheTag } from "./points";
import type { PointBreakdown, Standing } from "./types";

export async function getCachedStandings(orgId: string, season: string): Promise<Standing[]> {
  return unstable_cache(async () => getStandingsForSeason(orgId, season), ["standings", orgId, season], {
    revalidate: 30,
    tags: [standingsCacheTag(orgId, season)],
  })();
}

/** Same cache, same tag/window, but the row-expand-friendly shape the /leaderboard page needs. Sharing invalidateStandings's tag (see lib/repo.ts) means one registration invalidates both this and getCachedStandings together. */
export async function getCachedStandingsWithBreakdowns(
  orgId: string,
  season: string,
): Promise<Array<Standing & { breakdown: PointBreakdown }>> {
  return unstable_cache(
    async () => getStandingsWithBreakdownsForSeason(orgId, season),
    ["standings-with-breakdowns", orgId, season],
    { revalidate: 30, tags: [standingsCacheTag(orgId, season)] },
  )();
}

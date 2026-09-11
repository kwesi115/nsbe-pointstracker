/**
 * Which season an event belongs to.
 *
 * Events carry no season column — Config.SEASON names only the CURRENT one
 * (see lib/repo.ts, where it stamps membershipSeason/profileSeason). So an
 * event's season has to be derived from its date, and this is the one place
 * that derivation lives.
 *
 * A season is an academic year running August 1 → July 31, written
 * "2026-2027": an event on 2026-09-15 and one on 2027-04-02 are the same
 * season, which is what makes "this season's attendance" mean what an officer
 * expects in April. Pure and explicit about its inputs, like lib/points.ts —
 * nothing here reads the clock on its own.
 */

/** The month (0-indexed) a new season starts. August — the first NSBE events of the year predate the semester. */
const SEASON_START_MONTH = 7;

export function seasonOf(date: Date): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= SEASON_START_MONTH ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

/** The half-open range [start, end) covering `season`. Returns null for anything that isn't a "YYYY-YYYY" pair, so a junk query param filters nothing rather than silently matching nothing. */
export function seasonRange(season: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-(\d{4})$/.exec(season);
  if (!match) return null;
  const startYear = Number(match[1]);
  if (Number(match[2]) !== startYear + 1) return null;
  return {
    start: new Date(startYear, SEASON_START_MONTH, 1),
    end: new Date(startYear + 1, SEASON_START_MONTH, 1),
  };
}

export function isInSeason(date: Date, season: string): boolean {
  const range = seasonRange(season);
  if (!range) return false;
  return date.getTime() >= range.start.getTime() && date.getTime() < range.end.getTime();
}

/**
 * Every season present in a set of event dates, newest first — what the
 * season filter offers. Built from the data rather than from a fixed list so
 * a chapter's first year and its tenth both work with no configuration.
 */
export function seasonsPresent(dates: Array<Date | null>): string[] {
  const seasons = new Set<string>();
  for (const d of dates) {
    if (d) seasons.add(seasonOf(d));
  }
  return [...seasons].sort().reverse();
}

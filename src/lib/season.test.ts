/**
 * Season derivation — events carry no season column, so "this season's
 * attendance" is entirely a function of this file getting the academic-year
 * boundary right. The interesting cases are the two sides of August 1 and the
 * spring half of a season, which is where a calendar-year implementation
 * would quietly split one season in two.
 */

import { describe, expect, it } from "vitest";
import { isInSeason, seasonOf, seasonRange, seasonsPresent } from "./season";

describe("seasonOf", () => {
  it("puts the autumn half in the season that starts that year", () => {
    expect(seasonOf(new Date(2026, 8, 15))).toBe("2026-2027");
  });

  // The case a calendar-year split gets wrong.
  it("puts the spring half in the SAME season as the autumn before it", () => {
    expect(seasonOf(new Date(2027, 3, 2))).toBe("2026-2027");
  });

  it("starts a new season on August 1", () => {
    expect(seasonOf(new Date(2026, 6, 31))).toBe("2025-2026");
    expect(seasonOf(new Date(2026, 7, 1))).toBe("2026-2027");
  });
});

describe("seasonRange", () => {
  it("covers August 1 through the following July 31", () => {
    const range = seasonRange("2026-2027")!;
    expect(range.start).toEqual(new Date(2026, 7, 1));
    expect(range.end).toEqual(new Date(2027, 7, 1));
  });

  // A junk query param must not silently mean "match nothing" in a way that
  // looks like "this season had no events".
  it.each(["", "2026", "2026-2028", "not-a-season", "20262027"])("rejects %o rather than guessing", (raw) => {
    expect(seasonRange(raw)).toBeNull();
    expect(isInSeason(new Date(2026, 8, 1), raw)).toBe(false);
  });
});

describe("isInSeason", () => {
  it("includes the first instant and excludes the first instant of the next season", () => {
    expect(isInSeason(new Date(2026, 7, 1), "2026-2027")).toBe(true);
    expect(isInSeason(new Date(2027, 6, 31), "2026-2027")).toBe(true);
    expect(isInSeason(new Date(2027, 7, 1), "2026-2027")).toBe(false);
  });
});

describe("seasonsPresent", () => {
  it("lists the seasons the data actually contains, newest first", () => {
    const dates = [new Date(2026, 8, 1), new Date(2027, 2, 1), new Date(2025, 9, 1)];
    expect(seasonsPresent(dates)).toEqual(["2026-2027", "2025-2026"]);
  });

  it("collapses an autumn and a spring event into one season", () => {
    expect(seasonsPresent([new Date(2026, 8, 1), new Date(2027, 3, 1)])).toEqual(["2026-2027"]);
  });

  it("ignores events with no date rather than inventing a season for them", () => {
    expect(seasonsPresent([null, new Date(2026, 8, 1), null])).toEqual(["2026-2027"]);
    expect(seasonsPresent([null])).toEqual([]);
  });
});

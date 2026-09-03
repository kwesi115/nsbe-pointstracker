/**
 * Runs against the real Postgres instance at DATABASE_URL, same pattern as
 * workbook.test.ts — reads whatever's currently seeded rather than mocking.
 */

import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LEADERBOARD_DISCLAIMER, getConfigValue } from "@/lib/repo";
import { buildLeaderboardCsv } from "./csv";

describe("buildLeaderboardCsv — disclaimer header note", () => {
  it("includes the Config.LEADERBOARD_DISCLAIMER text as the CSV's first line, above the header row", async () => {
    const org = await prisma.org.findFirstOrThrow();
    const disclaimer = await getConfigValue(org.id, "LEADERBOARD_DISCLAIMER", DEFAULT_LEADERBOARD_DISCLAIMER);

    const { csv } = await buildLeaderboardCsv(org.id);
    const firstLine = csv.replace(/^﻿/, "").split("\r\n")[0];
    // toCsv() only quotes a field that needs it (comma/quote/newline) — match that rather than assuming quoting either way.
    const expected = /[",\n]/.test(disclaimer) ? `"${disclaimer.replace(/"/g, '""')}"` : disclaimer;

    expect(firstLine).toBe(expected);
    expect(csv).toContain("Rank,First Name,Last Name,Email,Points,Events");
  });
});

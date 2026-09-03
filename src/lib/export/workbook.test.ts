/**
 * Runs against the real Postgres instance at DATABASE_URL — exports whatever
 * is currently in the dev DB (seeded PointSystem/Config/admin at minimum) and
 * inspects the generated workbook's raw cell values.
 */

import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DEFAULT_LEADERBOARD_DISCLAIMER, getConfigValue } from "@/lib/repo";
import { buildWorkbookExport } from "./workbook";

const FORBIDDEN_SUBSTRINGS = ["passwordhash", "verificationtoken", "joincode", "$2a$", "$2b$"]; // bcrypt hash prefixes too

describe("buildWorkbookExport — no sensitive data", () => {
  it("contains no passwordHash, verificationToken, or join code anywhere in the workbook", async () => {
    const org = await prisma.org.findFirstOrThrow();
    const buffer = await buildWorkbookExport(org.id);
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);

    for (const ws of wb.worksheets) {
      // Header row: no column literally named after a credential field.
      const headerRow = ws.getRow(1);
      headerRow.eachCell((cell) => {
        const header = String(cell.value ?? "").toLowerCase();
        expect(header).not.toContain("password");
        expect(header).not.toContain("verificationtoken");
        expect(header).not.toContain("joincode");
      });

      // Every cell value in the sheet: no bcrypt hash or raw token substring.
      ws.eachRow((row) => {
        row.eachCell((cell) => {
          const value = String(cell.value ?? "").toLowerCase();
          for (const forbidden of FORBIDDEN_SUBSTRINGS) {
            expect(value).not.toContain(forbidden);
          }
        });
      });
    }

    // The Members sheet specifically must not exist with any credential column.
    const members = wb.getWorksheet("Members");
    expect(members).toBeDefined();
    const memberHeaders = (members!.getRow(1).values as unknown[]).map((v) => String(v ?? "").toLowerCase());
    expect(memberHeaders.some((h) => h.includes("password") || h.includes("token") || h.includes("code"))).toBe(false);
  });
});

describe("buildWorkbookExport — Leaderboard sheet disclaimer", () => {
  it("carries the Config.LEADERBOARD_DISCLAIMER text as a note above the header row", async () => {
    const org = await prisma.org.findFirstOrThrow();
    const disclaimer = await getConfigValue(org.id, "LEADERBOARD_DISCLAIMER", DEFAULT_LEADERBOARD_DISCLAIMER);

    const buffer = await buildWorkbookExport(org.id);
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);

    const sheet = wb.getWorksheet("Leaderboard");
    expect(sheet).toBeDefined();
    expect(sheet!.getCell(1, 1).value).toBe(disclaimer);
    expect(sheet!.getCell(2, 1).value).toBe("Rank");
  });
});

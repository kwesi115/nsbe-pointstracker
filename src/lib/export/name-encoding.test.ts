/**
 * Regression test for the mojibake bug (UTF-8 member names getting mangled
 * somewhere between the DB and the roster/exports). Runs against the real
 * Postgres instance at DATABASE_URL, same pattern as repo.test.ts — one Org
 * per file, a uniquely-named member, cleaned up afterward.
 */

import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/csv";
import { memberDisplayName } from "@/lib/format";
import { createMemberAccount, getMemberById, getMembersWithStats } from "@/lib/repo";
import { prisma } from "@/lib/prisma";
import { buildMembersCsv } from "./csv";
import { buildWorkbookExport } from "./workbook";

const FIRST_NAME = "José";
const LAST_NAME = "Fernández-O'Brien";

let orgId: string;
let email: string;
let memberId: string;

beforeAll(async () => {
  const org = await prisma.org.create({
    data: { slug: `name-encoding-test-${randomUUID()}`, name: "Name Encoding Test Org", shortName: "NE" },
  });
  orgId = org.id;
  email = `jose.fernandez-obrien.${randomUUID()}@example.com`;
  const { member } = await createMemberAccount(orgId, email, FIRST_NAME, LAST_NAME, "general", "test-setup");
  memberId = member.id;
});

afterAll(async () => {
  await prisma.adminLog.deleteMany({ where: { orgId } });
  await prisma.user.deleteMany({ where: { orgId } });
  await prisma.org.delete({ where: { id: orgId } });
});

describe("non-ASCII member names survive the full pipeline byte-identical", () => {
  it("round-trips through the DB read path", async () => {
    const member = await getMemberById(orgId, memberId);
    expect(member?.firstName).toBe(FIRST_NAME);
    expect(member?.lastName).toBe(LAST_NAME);

    const withStats = await getMembersWithStats(orgId);
    const row = withStats.find((m) => m.email === email);
    expect(row?.firstName).toBe(FIRST_NAME);
    expect(row?.lastName).toBe(LAST_NAME);
    expect(memberDisplayName(row!.firstName, row!.lastName, row!.email)).toBe(`${FIRST_NAME} ${LAST_NAME}`);
  });

  it("round-trips through the CSV export/import path with the BOM intact", async () => {
    const { csv } = await buildMembersCsv(orgId, [email]);
    expect(csv.charCodeAt(0)).toBe(0xfeff); // BOM present, so Excel opens it as UTF-8
    expect(csv).toContain(FIRST_NAME);
    expect(csv).toContain(LAST_NAME);

    const rows = parseCsv(csv);
    const header = rows[0];
    const dataRow = rows[1];
    expect(dataRow[header.indexOf("First Name")]).toBe(FIRST_NAME);
    expect(dataRow[header.indexOf("Last Name")]).toBe(LAST_NAME);
  });

  it("round-trips through the Excel workbook export", async () => {
    const buffer = await buildWorkbookExport(orgId);
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(buffer as any);
    const members = wb.getWorksheet("Members")!;
    const headerValues = (members.getRow(1).values as unknown[]).map((v) => String(v ?? ""));
    const firstNameCol = headerValues.indexOf("First Name");
    const lastNameCol = headerValues.indexOf("Last Name");

    let found = false;
    members.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (String(row.getCell(firstNameCol).value ?? "") === FIRST_NAME) {
        found = true;
        expect(String(row.getCell(lastNameCol).value ?? "")).toBe(LAST_NAME);
      }
    });
    expect(found).toBe(true);
  });
});

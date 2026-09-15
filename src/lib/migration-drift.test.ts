/**
 * The dev-time drift guard. The database is mocked; the folder listing is a
 * real temp directory, so the "what is on disk" half is exercised for real.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./prisma", () => ({ prisma: { $queryRawUnsafe: vi.fn() } }));

import { checkMigrationDrift, formatDriftReport } from "./migration-drift";
import { prisma } from "./prisma";

const queryRaw = prisma.$queryRawUnsafe as unknown as ReturnType<typeof vi.fn>;

/** A migrations folder holding `names`, plus the migration_lock.toml that must be ignored. */
function migrationsDir(names: string[]): string {
  const dir = mkdtempSync(path.join(tmpdir(), "drift-"));
  for (const name of names) {
    mkdirSync(path.join(dir, name));
    writeFileSync(path.join(dir, name, "migration.sql"), "-- noop\n");
  }
  writeFileSync(path.join(dir, "migration_lock.toml"), 'provider = "postgresql"\n');
  return dir;
}

function applied(name: string) {
  return { migration_name: name, finished_at: new Date(), rolled_back_at: null };
}

beforeEach(() => {
  queryRaw.mockReset();
});

describe("checkMigrationDrift", () => {
  it("is clean when the ledger matches the folder", async () => {
    queryRaw.mockResolvedValue([applied("0001_init"), applied("0002_later")]);

    const report = await checkMigrationDrift(migrationsDir(["0001_init", "0002_later"]));

    expect(report).toEqual({ kind: "ok", applied: 2 });
  });

  it("reports a migration folder the database has never applied", async () => {
    queryRaw.mockResolvedValue([applied("0001_init")]);

    // Exactly the setupCode outage: the file is committed, the database is not.
    const report = await checkMigrationDrift(migrationsDir(["0001_init", "20260914200000_setup_code_column"]));

    expect(report).toEqual({
      kind: "drift",
      pending: ["20260914200000_setup_code_column"],
      failed: [],
      unknown: [],
    });
    expect(formatDriftReport(report)).toContain("20260914200000_setup_code_column");
  });

  it("counts a started-but-unfinished migration as failed, not applied", async () => {
    queryRaw.mockResolvedValue([
      applied("0001_init"),
      { migration_name: "0002_half", finished_at: null, rolled_back_at: null },
    ]);

    const report = await checkMigrationDrift(migrationsDir(["0001_init", "0002_half"]));

    // Failed, not merely pending: "never run" and "ran halfway" need different
    // fixes, and the message names a different command for each.
    expect(report).toMatchObject({ kind: "drift", failed: ["0002_half"], pending: [] });
  });

  it("treats a migration resolved with --applied as applied, not failed", async () => {
    // What `prisma migrate resolve --applied` actually leaves behind, observed
    // on this project's own database: it does NOT repair the failed row, it
    // marks that one rolled back and inserts a SECOND, finished row under the
    // same name. Judging rows individually would report a deliberately
    // resolved migration as broken forever.
    queryRaw.mockResolvedValue([
      { migration_name: "0002_resolved", finished_at: null, rolled_back_at: new Date() },
      applied("0002_resolved"),
    ]);

    const report = await checkMigrationDrift(migrationsDir(["0002_resolved"]));

    expect(report).toEqual({ kind: "ok", applied: 1 });
  });

  it("counts a rolled-back migration as failed", async () => {
    queryRaw.mockResolvedValue([{ migration_name: "0002_back", finished_at: new Date(), rolled_back_at: new Date() }]);

    const report = await checkMigrationDrift(migrationsDir(["0002_back"]));

    expect(report).toMatchObject({ kind: "drift", failed: ["0002_back"] });
  });

  it("reports a migration the database applied but the checkout no longer has", async () => {
    queryRaw.mockResolvedValue([applied("0001_init"), applied("0002_deleted")]);

    const report = await checkMigrationDrift(migrationsDir(["0001_init"]));

    expect(report).toMatchObject({ kind: "drift", pending: [], unknown: ["0002_deleted"] });
  });

  it("recognizes a database whose ledger table does not exist at all", async () => {
    // What scripts/db-apply-sql.ts leaves behind: schema applied, ledger empty.
    queryRaw.mockRejectedValue(Object.assign(new Error('relation "_prisma_migrations" does not exist'), { code: "42P01" }));

    const report = await checkMigrationDrift(migrationsDir(["0001_init"]));

    expect(report).toMatchObject({ kind: "no-ledger", onDisk: ["0001_init"] });
    expect(formatDriftReport(report)).toContain("migrate resolve --applied");
  });

  it("stays quiet when there is simply no database to ask", async () => {
    queryRaw.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5432"));

    const report = await checkMigrationDrift(migrationsDir(["0001_init"]));

    expect(report.kind).toBe("indeterminate");
    expect(formatDriftReport(report)).toBeNull();
  });

  it("stays quiet when there is no migrations folder", async () => {
    const report = await checkMigrationDrift(path.join(tmpdir(), "definitely-not-here-4f2c"));

    expect(report.kind).toBe("indeterminate");
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe("formatDriftReport", () => {
  it("says nothing when everything is applied", () => {
    expect(formatDriftReport({ kind: "ok", applied: 3 })).toBeNull();
  });

  it("names the fix command for pending migrations", () => {
    const message = formatDriftReport({ kind: "drift", pending: ["0002_x"], failed: [], unknown: [] });

    expect(message).toContain("SCHEMA DRIFT");
    expect(message).toContain("prisma migrate deploy");
  });
});

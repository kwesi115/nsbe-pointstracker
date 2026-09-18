/**
 * Runs against the real Postgres instance at DATABASE_URL (buildWorkbookExport
 * needs a real org to export) and the local-disk backupStorage driver
 * (BACKUP_STORAGE_DRIVER unset in tests — see lib/storage.ts). Sensitive-data
 * stripping itself is workbook.test.ts's job; this only tests the
 * write/list round-trip.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { backupStorage } from "@/lib/storage";
import { listSeasonSnapshots, SNAPSHOT_PREFIX_FOR, writeSeasonSnapshot } from "./snapshot";

// A full season workbook built from the database — comfortably under 5s alone, but not under the
// full suite's parallel database load. Same allowance as src/auth.test.ts.
vi.setConfig({ testTimeout: 30_000 });

describe("writeSeasonSnapshot / listSeasonSnapshots", () => {
  afterEach(async () => {
    const org = await prisma.org.findFirstOrThrow();
    const keys = await backupStorage.list(SNAPSHOT_PREFIX_FOR(org.id));
    for (const key of keys) await backupStorage.delete(key);
  });

  it("writes a real workbook to backupStorage and lists it back, newest first", async () => {
    const org = await prisma.org.findFirstOrThrow();

    const first = await writeSeasonSnapshot(org.id, new Date("2026-01-01T03:00:00.000Z"));
    const second = await writeSeasonSnapshot(org.id, new Date("2026-01-02T03:00:00.000Z"));

    expect(first.bytes).toBeGreaterThan(0);
    const stored = await backupStorage.read(first.key);
    expect(stored.byteLength).toBe(first.bytes);

    const listing = await listSeasonSnapshots(org.id);
    const keys = listing.map((l) => l.key);
    expect(keys).toContain(first.key);
    expect(keys).toContain(second.key);
    // Newest first.
    expect(keys.indexOf(second.key)).toBeLessThan(keys.indexOf(first.key));
  });

  it("returns an empty list for an org with no snapshots yet", async () => {
    const org = await prisma.org.create({ data: { slug: `snapshot-test-${Date.now()}`, name: "Snapshot Test Org", shortName: "STO" } });
    try {
      expect(await listSeasonSnapshots(org.id)).toEqual([]);
    } finally {
      await prisma.org.delete({ where: { id: org.id } });
    }
  });
});

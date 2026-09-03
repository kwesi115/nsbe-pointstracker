import { describe, expect, it } from "vitest";
import { backupKey, keysToPrune, parseBackupDate } from "./backup-retention";

function dayKey(orgSlug: string, isoDate: string): string {
  return backupKey(orgSlug, new Date(`${isoDate}T03:00:00.000Z`));
}

describe("backupKey / parseBackupDate — round-trip", () => {
  it("parseBackupDate recovers the exact instant backupKey encoded", () => {
    const now = new Date("2026-03-05T08:15:30.123Z");
    const key = backupKey("howard-nsbe", now);
    expect(key).toMatch(/^db-backups\/nsbe-howard-nsbe-2026-03-05T08-15-30-123Z\.sql\.gz$/);
    expect(parseBackupDate(key)?.toISOString()).toBe(now.toISOString());
  });

  it("parseBackupDate returns null for a key with no embedded timestamp", () => {
    expect(parseBackupDate("db-backups/not-a-backup.sql.gz")).toBeNull();
  });
});

describe("keysToPrune — 7 daily / 4 weekly / 12 monthly retention", () => {
  it("keeps everything when there are fewer than 7 backups total", () => {
    const keys = [dayKey("org", "2026-03-01"), dayKey("org", "2026-03-02"), dayKey("org", "2026-03-03")];
    expect(keysToPrune(keys)).toEqual([]);
  });

  it("keeps exactly the most recent 7 when there are 7 consecutive daily backups and nothing older", () => {
    const keys = Array.from({ length: 7 }, (_, i) => dayKey("org", `2026-03-${String(i + 1).padStart(2, "0")}`));
    expect(keysToPrune(keys)).toEqual([]);
  });

  it("prunes daily backups older than 7 days that don't also land on a kept weekly/monthly bucket", () => {
    // 40 consecutive daily backups, most recent = day 40 (2026-04-09).
    const keys = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 2, 1)); // 2026-03-01
      d.setUTCDate(d.getUTCDate() + i);
      return backupKey("org", d);
    });
    const pruned = new Set(keysToPrune(keys));
    const kept = keys.filter((k) => !pruned.has(k));

    // The most recent 7 days are never pruned.
    for (const k of keys.slice(-7)) {
      expect(pruned.has(k)).toBe(false);
    }
    // Something from well over a month ago (day 1, the oldest) is pruned
    // unless it happens to be the sole representative of its month/week —
    // day 1 of 40 daily backups is far older than the 12-month/4-week
    // windows can reach from "today" (day 40), so it must be pruned.
    expect(pruned.has(keys[0])).toBe(true);
    // Kept set is strictly smaller than the full set once retention kicks in.
    expect(kept.length).toBeLessThan(keys.length);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("keeps at most one backup per calendar day even if the daily window would otherwise allow more", () => {
    // Two backups on the same day — only the newer one should ever be kept.
    const same1 = backupKey("org", new Date("2026-03-05T01:00:00.000Z"));
    const same2 = backupKey("org", new Date("2026-03-05T23:00:00.000Z"));
    const pruned = keysToPrune([same1, same2]);
    expect(pruned).toEqual([same1]);
  });

  it("ignores keys it can't parse a date from, never prunes them", () => {
    const keys = ["db-backups/garbage.sql.gz", dayKey("org", "2026-03-01")];
    expect(keysToPrune(keys)).toEqual([]);
  });
});

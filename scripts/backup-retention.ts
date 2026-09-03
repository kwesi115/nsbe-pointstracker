/**
 * Pure retention-pruning logic for scripts/backup-db.ts, split out so it's
 * testable without pg_dump/psql or object storage — see
 * backup-retention.test.ts. Retention: last 7 daily, last 4 weekly, last 12
 * monthly; everything else is pruned.
 */

export const BACKUP_PREFIX = "db-backups/";
export const RETAIN_DAILY = 7;
export const RETAIN_WEEKLY = 4;
export const RETAIN_MONTHLY = 12;

export function backupKey(orgSlug: string, now: Date): string {
  const filenameSafeIso = now.toISOString().replace(/:/g, "-").replace(/\./g, "-");
  return `${BACKUP_PREFIX}nsbe-${orgSlug}-${filenameSafeIso}.sql.gz`;
}

/** ISO week key ("2026-W05") for the weekly retention bucket. */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Newest-first backups, one entry kept per distinct bucketFn(date) value, up to `count` distinct buckets. */
export function pickKeep(sortedDesc: Array<{ key: string; date: Date }>, bucketFn: (d: Date) => string, count: number): Set<string> {
  const seen = new Set<string>();
  const keep = new Set<string>();
  for (const entry of sortedDesc) {
    const bucket = bucketFn(entry.date);
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    keep.add(entry.key);
    if (seen.size >= count) break;
  }
  return keep;
}

export function parseBackupDate(key: string): Date | null {
  const match = key.match(/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.sql\.gz$/);
  if (!match) return null;
  // Filenames can't contain ':' — ISO string colons were replaced with '-' when writing (see backupKey above).
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Given every existing backup key, returns the keys to DELETE under the 7-daily/4-weekly/12-monthly retention rule. */
export function keysToPrune(allKeys: string[]): string[] {
  const dated = allKeys
    .map((k) => ({ key: k, date: parseBackupDate(k) }))
    .filter((e): e is { key: string; date: Date } => e.date !== null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const keep = new Set<string>([
    ...pickKeep(dated, (d) => d.toISOString().slice(0, 10), RETAIN_DAILY),
    ...pickKeep(dated, isoWeekKey, RETAIN_WEEKLY),
    ...pickKeep(dated, (d) => d.toISOString().slice(0, 7), RETAIN_MONTHLY),
  ]);
  return dated.filter((e) => !keep.has(e.key)).map((e) => e.key);
}

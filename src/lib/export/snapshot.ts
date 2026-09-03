/**
 * Layer 2 of the recovery plan (see docs/RECOVERY.md): a human-readable
 * season snapshot — the full Excel workbook, uploaded to the same private
 * object storage as the nightly pg_dump (see lib/storage.ts backupStorage,
 * scripts/backup-db.ts). If Postgres is ever unrecoverable, a workbook is
 * still a complete record of the season any E-Board member can open — no
 * `psql`/`pg_restore` required.
 *
 * buildWorkbookExport (see ./workbook.ts) already never includes
 * passwordHash, verificationToken, or join codes — see that file's own
 * header comment and workbook.test.ts's regression test.
 */

import { backupStorage } from "@/lib/storage";
import { buildWorkbookExport } from "./workbook";

export interface SnapshotResult {
  key: string;
  bytes: number;
  createdAt: string;
}

export const SNAPSHOT_PREFIX_FOR = (orgId: string) => `snapshots/${orgId}/`;

/** Filename-safe timestamp so multiple snapshots the same day (e.g. one nightly + one pre-destructive-action) never collide. */
function snapshotKey(orgId: string, now: Date): string {
  const filenameSafeIso = now.toISOString().replace(/:/g, "-").replace(/\./g, "-");
  return `${SNAPSHOT_PREFIX_FOR(orgId)}nsbe-points-${filenameSafeIso}.xlsx`;
}

/** Writes a workbook snapshot to object storage for one org and returns where it landed. Called both by the manual /admin/exports action and automatically before a destructive admin action (bulk import, category point-value edit). */
export async function writeSeasonSnapshot(orgId: string, now: Date = new Date()): Promise<SnapshotResult> {
  const buffer = await buildWorkbookExport(orgId);
  const key = snapshotKey(orgId, now);
  await backupStorage.put(key, buffer);
  return { key, bytes: buffer.byteLength, createdAt: now.toISOString() };
}

export interface SnapshotListing {
  key: string;
  createdAt: string | null;
  filename: string;
}

/** Prior snapshots for one org, newest first — for /admin/exports' "prior snapshots" list. */
export async function listSeasonSnapshots(orgId: string): Promise<SnapshotListing[]> {
  const prefix = SNAPSHOT_PREFIX_FOR(orgId);
  const keys = await backupStorage.list(prefix);
  return keys
    .map((key) => {
      const filename = key.slice(prefix.length);
      const match = filename.match(/-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.xlsx$/);
      const createdAt = match
        ? (() => {
            const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "T$1:$2:$3.$4Z");
            const d = new Date(iso);
            return Number.isNaN(d.getTime()) ? null : d.toISOString();
          })()
        : null;
      return { key, filename, createdAt };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

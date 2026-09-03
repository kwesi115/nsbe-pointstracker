/**
 * Layer 1 of the recovery plan (see docs/RECOVERY.md): a scheduled logical
 * dump of the whole database, gzipped and uploaded to backup object storage.
 *
 * Run manually with `npm run backup`. Scheduled via
 * .github/workflows/backup.yml at 03:00 America/New_York daily — NOT a
 * Vercel Cron hitting a Route Handler, because Vercel's default Node
 * serverless runtime doesn't ship the `pg_dump` binary; a GitHub Actions
 * runner does (see that workflow file's comments, including how to disable
 * it).
 *
 * Storage target: lib/storage.ts's `backupStorage` — local disk by default
 * (BACKUP_STORAGE_DRIVER unset), a private S3/R2 bucket when
 * BACKUP_STORAGE_DRIVER=s3 (see that file for the BACKUP_S3_* env vars). The
 * bucket must never be public — a backup contains every member's personal
 * data.
 *
 * Exits non-zero on ANY failure (pg_dump, upload, or the AdminLog write
 * itself) — a backup script that reports success on failure is worse than no
 * backup script. Writes an AdminLog entry either way (success or failure) so
 * a silently-broken nightly backup is visible from /admin, not just from a
 * CI run nobody is watching.
 */

import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local" });

import { pgConnectionString } from "./pg-connection";
import { BACKUP_PREFIX, backupKey, keysToPrune } from "./backup-retention";

async function main() {
  const { spawn } = await import("node:child_process");
  const { gzipSync } = await import("node:zlib");
  const { backupStorage } = await import("../src/lib/storage");
  const { getActiveOrgs, logSystemAdminEvent } = await import("../src/lib/repo");
  const { prisma } = await import("../src/lib/prisma");

  function run(cmd: string, args: string[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      const errChunks: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => chunks.push(d));
      child.stderr.on("data", (d: Buffer) => errChunks.push(d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`${cmd} exited ${code}: ${Buffer.concat(errChunks).toString("utf8").slice(0, 2000)}`));
      });
    });
  }

  let orgSlug = "org";
  let orgId: string | null = null;
  try {
    const orgs = await getActiveOrgs();
    if (orgs[0]) {
      orgSlug = orgs[0].slug;
      orgId = orgs[0].id;
    }

    console.log(`Dumping ${process.env.DATABASE_URL ? "database" : "(no DATABASE_URL set!)"}...`);
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    // Prisma's connection string carries a `?schema=` query param that isn't
    // a libpq-recognized URI parameter — pg_dump rejects it outright
    // ("invalid URI query parameter: schema"). A full pg_dump doesn't need
    // it anyway (it dumps every schema in the database by default).
    const dump = await run("pg_dump", [pgConnectionString(process.env.DATABASE_URL), "--no-owner", "--no-privileges"]);
    const gzipped = gzipSync(dump);

    const key = backupKey(orgSlug, new Date());
    console.log(`Uploading ${key} (${gzipped.byteLength} bytes)...`);
    await backupStorage.put(key, gzipped);

    console.log("Pruning old backups...");
    const allKeys = await backupStorage.list(BACKUP_PREFIX);
    const toPrune = keysToPrune(allKeys);
    for (const pruneKey of toPrune) {
      await backupStorage.delete(pruneKey);
    }
    console.log(`Kept ${allKeys.length - toPrune.length} backup(s), pruned ${toPrune.length}.`);

    if (orgId) {
      await logSystemAdminEvent(orgId, {
        actor: "system",
        action: "db_backup",
        target: key,
        detail: `${gzipped.byteLength} bytes, ${toPrune.length} pruned`,
      });
    }
    console.log("Backup complete.");
    await prisma.$disconnect();
  } catch (err) {
    console.error("Backup FAILED:", err);
    if (orgId) {
      try {
        await logSystemAdminEvent(orgId, {
          actor: "system",
          action: "db_backup_failed",
          target: "db-backups",
          detail: (err as Error).message?.slice(0, 500) ?? String(err),
        });
      } catch (logErr) {
        console.error("Also failed to write the failure AdminLog entry:", logErr);
      }
    }
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();

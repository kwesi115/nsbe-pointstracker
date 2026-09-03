/**
 * Restores a gzipped pg_dump (see scripts/backup-db.ts) into DATABASE_URL.
 *
 * Usage: npm run restore -- <path-to-dump.sql.gz> --confirm
 *
 * Two hard refusals, both required, neither bypassable by a flag alone:
 *   1. --confirm must be passed explicitly.
 *   2. DATABASE_URL must contain "localhost", OR RESTORE_ALLOW_REMOTE=true
 *      must be set. A restore script that can silently overwrite production
 *      is worse than no restore script — see docs/RECOVERY.md.
 */

import { config as loadEnv } from "dotenv";
loadEnv();
loadEnv({ path: ".env.local" });

import { pgConnectionString } from "./pg-connection";
import { assertConfirmed, assertTargetAllowed, RestoreRefused } from "./restore-guards";

async function main() {
  const { spawn } = await import("node:child_process");
  const { gunzipSync } = await import("node:zlib");
  const { readFile } = await import("node:fs/promises");

  const args = process.argv.slice(2);
  const confirmed = args.includes("--confirm");
  const dumpPath = args.find((a) => !a.startsWith("--"));

  if (!dumpPath) {
    console.error("Usage: npm run restore -- <path-to-dump.sql.gz> --confirm");
    process.exit(1);
  }

  const databaseUrl = process.env.DATABASE_URL ?? "";
  try {
    assertConfirmed(confirmed);
    assertTargetAllowed(databaseUrl, process.env.RESTORE_ALLOW_REMOTE);
  } catch (err) {
    if (err instanceof RestoreRefused) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  console.log(`Restoring ${dumpPath} into ${databaseUrl.replace(/:[^:@]+@/, ":****@")}...`);

  const gzipped = await readFile(dumpPath);
  const sql = gunzipSync(gzipped);

  await new Promise<void>((resolve, reject) => {
    const child = spawn("psql", [pgConnectionString(databaseUrl)], { stdio: ["pipe", "inherit", "inherit"] });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited ${code}`));
    });
    child.stdin.write(sql);
    child.stdin.end();
  });

  console.log("Restore complete.");
}

main().catch((err) => {
  console.error("Restore FAILED:", err);
  process.exit(1);
});

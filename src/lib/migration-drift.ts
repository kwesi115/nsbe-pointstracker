/**
 * "Is the database actually at the schema this code was written against?"
 * asked once, at startup, in development — instead of discovered later as a
 * broken page.
 *
 * This exists because that is exactly how the last two schema gaps were found.
 * A column present in prisma/schema.prisma but absent from the database does
 * not announce itself: Prisma builds a SELECT naming it, Postgres rejects the
 * whole statement, and whatever code path happened to run that query throws.
 * When the path was the NextAuth session callback, the blast radius was the
 * entire app — every layout calls auth(), including the public one that
 * renders /signin, so a single missing column locked every user out of every
 * page with no way back in. The narrow fix for that lives in auth.ts and
 * repo.ts getSessionUser; this is the general-purpose smoke alarm.
 *
 * It compares the migrations Prisma has RECORDED as applied against the
 * folders in prisma/migrations — the same comparison `prisma migrate status`
 * makes. Comparing the ledger rather than introspecting columns is deliberate:
 * it is one cheap query, it needs no schema parsing, and a drifted ledger is
 * the upstream cause of every missing column anyway.
 *
 * DEV ONLY, ADVISORY ONLY. It never throws and never blocks startup — a
 * warning that took the dev server down with it would be worse than the
 * problem. Production gets the real guarantee from `prisma migrate deploy` in
 * the build script (package.json), which refuses to build on a pending
 * migration rather than merely mentioning it.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { prisma } from "./prisma";

/** The ledger Prisma keeps. Named as a raw string because the client has no model for it. */
const MIGRATIONS_TABLE = "_prisma_migrations";

type AppliedRow = { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null };

export type DriftReport =
  | { kind: "ok"; applied: number }
  /** The ledger table itself is absent — nothing has ever been applied through `prisma migrate`. */
  | { kind: "no-ledger"; onDisk: string[] }
  | { kind: "drift"; pending: string[]; failed: string[]; unknown: string[] }
  /** Could not tell (no database reachable, no migrations folder). Not drift — stay quiet. */
  | { kind: "indeterminate"; reason: string };

/** Migration folder names, sorted — the same ordering Prisma applies them in. */
function migrationsOnDisk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function checkMigrationDrift(migrationsDir: string): Promise<DriftReport> {
  let onDisk: string[];
  try {
    onDisk = migrationsOnDisk(migrationsDir);
  } catch {
    return { kind: "indeterminate", reason: `no migrations folder at ${migrationsDir}` };
  }

  let rows: AppliedRow[];
  try {
    rows = await prisma.$queryRawUnsafe<AppliedRow[]>(
      `SELECT "migration_name", "finished_at", "rolled_back_at" FROM "${MIGRATIONS_TABLE}"`,
    );
  } catch (err) {
    // Postgres 42P01 = undefined_table, and that is a real reportable state:
    // this repo also carries scripts/db-apply-sql.ts, which applies migration
    // SQL WITHOUT writing the ledger, so a database built that way looks
    // entirely unmigrated to `prisma migrate deploy` — which would then try to
    // replay every migration from scratch. Worth saying loudly.
    if (isUndefinedTable(err)) return { kind: "no-ledger", onDisk };
    // Anything else (database down, bad URL, no permission) is not evidence of
    // drift, and a dev with no database running should not be shouted at.
    return { kind: "indeterminate", reason: err instanceof Error ? err.message : String(err) };
  }

  // ONE MIGRATION CAN HAVE SEVERAL LEDGER ROWS, which is the subtlety here.
  // `prisma migrate resolve --applied` does not repair the failed row: it marks
  // that one rolled back and INSERTS A SECOND row for the same name, finished.
  // Judging each row on its own would then report a perfectly healthy,
  // deliberately resolved migration as failed forever. So a name is decided by
  // its best row — one good row is enough — exactly as `prisma migrate status`
  // decides it.
  const applied = new Set<string>();
  const broken = new Set<string>();
  for (const row of rows) {
    // finished_at null with no rollback = started and never completed; a
    // rolled-back row is not applied either. Both leave the database in a state
    // no migration file describes — unless a later row succeeded.
    if (row.rolled_back_at !== null || row.finished_at === null) {
      broken.add(row.migration_name);
      continue;
    }
    applied.add(row.migration_name);
  }

  const failed = [...broken].filter((name) => !applied.has(name)).sort();
  // Not applied and not failed — simply never run.
  const pending = onDisk.filter((name) => !applied.has(name) && !broken.has(name));
  // Recorded as applied but no longer on disk — a deleted or renamed migration
  // folder. The database carries changes this checkout cannot account for.
  const unknown = [...applied].filter((name) => !onDisk.includes(name)).sort();

  if (pending.length === 0 && failed.length === 0 && unknown.length === 0) {
    return { kind: "ok", applied: applied.size };
  }
  return { kind: "drift", pending, failed, unknown };
}

function isUndefinedTable(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  if ((err as { code?: unknown }).code === "42P01") return true;
  const message = err instanceof Error ? err.message : "";
  return /does not exist/i.test(message) && message.includes(MIGRATIONS_TABLE);
}

const RULE = "=".repeat(78);

/** Formats a report for the terminal. Returns null when there is nothing to say. */
export function formatDriftReport(report: DriftReport): string | null {
  if (report.kind === "ok" || report.kind === "indeterminate") return null;

  const lines: string[] = [
    "",
    RULE,
    "  !!  DATABASE SCHEMA DRIFT — your database does not match prisma/migrations",
    RULE,
  ];

  if (report.kind === "no-ledger") {
    lines.push(
      `  Prisma has no record of ANY migration (the "${MIGRATIONS_TABLE}" table is missing),`,
      `  but ${report.onDisk.length} migration folder(s) exist on disk.`,
      "",
      "  Likely cause: the schema was applied with `npm run db:migrate`",
      "  (scripts/db-apply-sql.ts), which writes SQL but deliberately does NOT",
      "  update Prisma's ledger.",
      "",
      "  Fix:  npx prisma migrate resolve --applied <migration_name>   (once per applied migration)",
      "    or: npx prisma migrate deploy                               (on an empty database)",
    );
  } else {
    if (report.pending.length > 0) {
      lines.push(`  NOT APPLIED (${report.pending.length}) — columns these add are MISSING from the database:`);
      for (const name of report.pending) lines.push(`    - ${name}`);
      lines.push("", "  Fix:  npx prisma migrate deploy");
    }
    if (report.failed.length > 0) {
      lines.push("", `  FAILED / ROLLED BACK (${report.failed.length}) — applied partially or not at all:`);
      for (const name of report.failed) lines.push(`    - ${name}`);
      lines.push("", "  Fix:  npx prisma migrate resolve --rolled-back <migration_name>");
    }
    if (report.unknown.length > 0) {
      lines.push("", `  APPLIED BUT NOT ON DISK (${report.unknown.length}) — deleted or renamed migration folders:`);
      for (const name of report.unknown) lines.push(`    - ${name}`);
    }
  }

  lines.push(
    "",
    "  Until this is resolved, any query touching an unmigrated column throws —",
    "  which usually surfaces as an unrelated page breaking, not as this message.",
    RULE,
    "",
  );
  return lines.join("\n");
}

/**
 * The startup entry point. Swallows everything: this is a diagnostic, and a
 * diagnostic that can take down `next dev` has failed at its job.
 */
export async function warnOnMigrationDrift(cwd: string = process.cwd()): Promise<void> {
  try {
    const report = await checkMigrationDrift(path.join(cwd, "prisma", "migrations"));
    const message = formatDriftReport(report);
    if (message) console.warn(message);
  } catch (err) {
    console.warn("[migration-drift] check skipped:", err instanceof Error ? err.message : String(err));
  }
}

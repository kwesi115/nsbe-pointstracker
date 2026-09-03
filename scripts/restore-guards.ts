/**
 * Pure guard checks for scripts/restore-db.ts, split out so they're testable
 * without spawning psql or touching a real database — see
 * restore-guards.test.ts. A restore script that can silently overwrite
 * production is worse than no restore script (see docs/RECOVERY.md), so
 * these two checks are deliberately hard failures, not warnings.
 */

export class RestoreRefused extends Error {}

export function assertConfirmed(confirmed: boolean): void {
  if (!confirmed) {
    throw new RestoreRefused("Refusing to run without --confirm. This OVERWRITES the target database.");
  }
}

export function assertTargetAllowed(databaseUrl: string, allowRemoteEnv: string | undefined): void {
  const isLocalhost = /localhost|127\.0\.0\.1/.test(databaseUrl);
  const allowRemote = allowRemoteEnv === "true";
  if (!isLocalhost && !allowRemote) {
    throw new RestoreRefused(
      "Refusing to run: DATABASE_URL doesn't look like localhost, and RESTORE_ALLOW_REMOTE=true is not set.\n" +
        "This guard exists because a restore script that can silently overwrite production is worse than no restore script.\n" +
        "If you really mean to restore into a remote database, set RESTORE_ALLOW_REMOTE=true and re-run.",
    );
  }
}

/**
 * Pure guard checks for scripts/clear-seed-data.ts, split out so they're
 * testable without a real database — see clear-seed-guards.test.ts. A script
 * that deletes every GENERAL/GUEST account and all event/registration data is
 * worse than no script at all if it can run by accident, so both checks are
 * hard failures, not warnings (same reasoning as restore-guards.ts).
 */

export class ClearSeedRefused extends Error {}

export function assertConfirmed(confirmed: boolean): void {
  if (!confirmed) {
    throw new ClearSeedRefused(
      "Refusing to run without --confirm. This DELETES every GENERAL/GUEST account, all Registrations, " +
        "Answers, PointAwards, EventGroups, Events, and UploadedFiles for every org.",
    );
  }
}

export function assertProductionAllowed(nodeEnv: string | undefined, allowProductionEnv: string | undefined): void {
  const isProduction = nodeEnv === "production";
  const allowed = allowProductionEnv === "true";
  if (isProduction && !allowed) {
    throw new ClearSeedRefused(
      "Refusing to run: NODE_ENV=production and CLEAR_SEED_ALLOW_PRODUCTION=true is not set.\n" +
        "This guard exists because clearing seed data against a live production database by accident is " +
        "unrecoverable without the pre-delete snapshot.\n" +
        "If you really mean to run this against production, set CLEAR_SEED_ALLOW_PRODUCTION=true and re-run.",
    );
  }
}

/**
 * Org-wide feature switches stored in Config, toggled from /admin/settings by
 * an ADMIN — no deploy, no env var, no code change to flip one.
 *
 * A flag here is NOT a permission. It answers "is this surface switched on for
 * this org right now", never "is this caller allowed to use it" — the role and
 * grant checks in lib/access.ts still run independently, and BOTH have to pass.
 * The order matters: check access first, then the flag, so a GENERAL member
 * poking at a disabled admin surface is told they lack access rather than
 * learning which features the org has turned off.
 *
 * EXPORTS_ENABLED gates /admin/exports, every /api/admin/export/* endpoint, and
 * every "Export CSV" affordance that points at one. It defaults to "false":
 * exports write a full-roster workbook to object storage, and until backup
 * storage is settled the safe default is off. The export generators in
 * lib/export/ and their tests are untouched by this flag — nothing here
 * deletes or bypasses that code, it only decides whether a request reaches it.
 */

import { getConfigValue } from "./repo";
import type { FeatureName } from "./types";

/** The Config key backing each flag, and what it falls back to when no row exists. */
const FLAGS: Record<FeatureName, { key: string; default: boolean }> = {
  exports: { key: "EXPORTS_ENABLED", default: false },
};

export function configKeyFor(feature: FeatureName): string {
  return FLAGS[feature].key;
}

export function defaultFor(feature: FeatureName): boolean {
  return FLAGS[feature].default;
}

/**
 * Only the exact string "true" enables a flag. A Config row holding "", "1",
 * "yes", or anything else reads as off — a feature that gates data leaving the
 * org fails closed on a typo, never open.
 */
export function parseFlag(raw: string, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export async function isFeatureEnabled(orgId: string, feature: FeatureName): Promise<boolean> {
  const { key, default: fallback } = FLAGS[feature];
  return parseFlag(await getConfigValue(orgId, key, ""), fallback);
}

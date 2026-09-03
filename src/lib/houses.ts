/**
 * NSBE House reference data — structured (code/name/color), not the old
 * pipe-delimited HOUSES_LIST string. Stored as a JSON-encoded Config value
 * (same Config.orgId/key/value row, see lib/repo.ts getCoreFormConfig) so a
 * chapter can rename or recolor a House from /admin/settings with no deploy.
 * The color is part of the House's identity now — never render a House name
 * without it (see components/ui/HouseDot.tsx), and never rely on color alone.
 */

export interface House {
  code: string;
  name: string;
  color: string;
}

export const DEFAULT_HOUSES: House[] = [
  { code: "JEMISON", name: "Jemison", color: "#C8102E" },
  { code: "LATIMER", name: "Latimer", color: "#F2A900" },
  { code: "DEAN", name: "Dean", color: "#00843D" },
  { code: "JOHNSON", name: "Johnson", color: "#1A1A1A" },
];

function isHouse(v: unknown): v is House {
  if (!v || typeof v !== "object") return false;
  const h = v as Record<string, unknown>;
  return typeof h.code === "string" && typeof h.name === "string" && typeof h.color === "string";
}

/** Parses the Config.HOUSES_LIST JSON value — falls back to DEFAULT_HOUSES on empty/corrupt data rather than leaving the House dropdown empty. */
export function parseHouses(raw: string): House[] {
  if (!raw.trim()) return DEFAULT_HOUSES;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isHouse)) return parsed;
  } catch {
    // Corrupt Config value — fall back below rather than throwing.
  }
  return DEFAULT_HOUSES;
}

export function serializeHouses(houses: House[]): string {
  return JSON.stringify(houses);
}

/** Stable-ish identifier derived from a House's name — regenerated on every /admin/settings save, so renaming a House also changes its code (no separate identity to keep in sync). */
export function codeFromName(name: string): string {
  const code = name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || "HOUSE";
}

export function houseColor(houses: House[], name: string): string | undefined {
  return houses.find((h) => h.name === name)?.color;
}

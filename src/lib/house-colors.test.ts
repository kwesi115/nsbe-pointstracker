/**
 * House colours, and the one place they come from.
 *
 * Dean and Latimer swapped. Every surface that shows a colour — the signup
 * dropdown, /account, the roster, member detail, and the verified confirmation
 * row — reads it from the same House objects, via HouseDot: either the org's
 * stored Config.HOUSES_LIST or DEFAULT_HOUSES when that is absent or unparseable.
 * So asserting the source and the parser covers all of them, and there is no
 * per-surface colour literal that could disagree.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSES, parseHouses, serializeHouses } from "./houses";

const EXPECTED: Record<string, string> = {
  Jemison: "#C8102E", // red
  Latimer: "#00843D", // green
  Dean: "#F2A900", // yellow
  Johnson: "#1A1A1A", // black
};

function colorOf(houses: { name: string; color: string }[], name: string): string | undefined {
  return houses.find((h) => h.name === name)?.color;
}

describe("the four Houses and their colours", () => {
  it("Dean renders yellow and Latimer renders green", () => {
    // The swap, stated plainly: these two had each other's colour.
    expect(colorOf(DEFAULT_HOUSES, "Dean")).toBe("#F2A900");
    expect(colorOf(DEFAULT_HOUSES, "Latimer")).toBe("#00843D");
  });

  it("Jemison stays red and Johnson stays black", () => {
    expect(colorOf(DEFAULT_HOUSES, "Jemison")).toBe("#C8102E");
    expect(colorOf(DEFAULT_HOUSES, "Johnson")).toBe("#1A1A1A");
  });

  it("is exactly these four, each with a distinct colour", () => {
    expect(DEFAULT_HOUSES.map((h) => h.name)).toEqual(["Jemison", "Latimer", "Dean", "Johnson"]);
    for (const [name, color] of Object.entries(EXPECTED)) {
      expect(colorOf(DEFAULT_HOUSES, name)).toBe(color);
    }
    expect(new Set(DEFAULT_HOUSES.map((h) => h.color)).size).toBe(4);
  });

  it("every colour is a full six-digit hex, which is what HouseDot renders directly", () => {
    for (const house of DEFAULT_HOUSES) {
      expect(house.color).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("the colour every surface actually reads", () => {
  it("survives a round trip through the stored Config value", () => {
    // What /admin/settings writes and getCoreFormConfig reads back.
    const restored = parseHouses(serializeHouses(DEFAULT_HOUSES));
    expect(restored).toEqual(DEFAULT_HOUSES);
    expect(colorOf(restored, "Dean")).toBe("#F2A900");
    expect(colorOf(restored, "Latimer")).toBe("#00843D");
  });

  it("falls back to the swapped defaults when the stored value is missing or unparseable", () => {
    // The state this database was actually in: a legacy pipe-delimited string
    // that is not JSON. The fallback is why the swap takes effect even where the
    // stored value was never migrated.
    for (const stored of ["", "   ", "House A|House B|House C", "{not json"]) {
      const houses = parseHouses(stored);
      expect(colorOf(houses, "Dean")).toBe("#F2A900");
      expect(colorOf(houses, "Latimer")).toBe("#00843D");
    }
  });

  it("respects a chapter's own colours when they have customised them", () => {
    // The defaults are a default, not a hardcode — a stored list wins.
    const custom = [{ code: "DEAN", name: "Dean", color: "#123456" }];
    expect(colorOf(parseHouses(JSON.stringify(custom)), "Dean")).toBe("#123456");
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSES, codeFromName, parseHouses, serializeHouses } from "./houses";

describe("DEFAULT_HOUSES", () => {
  it("is exactly the four real NSBE Houses, with their colors", () => {
    expect(DEFAULT_HOUSES).toEqual([
      { code: "JEMISON", name: "Jemison", color: "#C8102E" },
      { code: "LATIMER", name: "Latimer", color: "#F2A900" },
      { code: "DEAN", name: "Dean", color: "#00843D" },
      { code: "JOHNSON", name: "Johnson", color: "#1A1A1A" },
    ]);
  });
});

describe("parseHouses", () => {
  it("falls back to DEFAULT_HOUSES for an empty Config value", () => {
    expect(parseHouses("")).toEqual(DEFAULT_HOUSES);
    expect(parseHouses("   ")).toEqual(DEFAULT_HOUSES);
  });

  it("falls back to DEFAULT_HOUSES for corrupt JSON", () => {
    expect(parseHouses("not json")).toEqual(DEFAULT_HOUSES);
  });

  it("falls back to DEFAULT_HOUSES when the shape is wrong (e.g. the old pipe-delimited string, or missing a color)", () => {
    expect(parseHouses("House Turing|House Hamilton")).toEqual(DEFAULT_HOUSES);
    expect(parseHouses(JSON.stringify([{ code: "X", name: "X" }]))).toEqual(DEFAULT_HOUSES);
  });

  it("round-trips a valid, edited House list", () => {
    const edited = [{ code: "CUSTOM", name: "Custom House", color: "#123456" }];
    expect(parseHouses(serializeHouses(edited))).toEqual(edited);
  });
});

describe("codeFromName", () => {
  it("uppercases and strips non-alphanumerics", () => {
    expect(codeFromName("Jemison")).toBe("JEMISON");
    expect(codeFromName("  New House Name! ")).toBe("NEW_HOUSE_NAME");
  });

  it("never returns an empty code", () => {
    expect(codeFromName("")).toBe("HOUSE");
    expect(codeFromName("!!!")).toBe("HOUSE");
  });
});

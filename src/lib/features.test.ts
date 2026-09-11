/**
 * The feature-flag reader. getConfigValue is mocked; the parsing — the part
 * that decides whether a whole surface is reachable — runs for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./repo", () => ({ getConfigValue: vi.fn() }));

import { getConfigValue } from "./repo";
import { configKeyFor, defaultFor, isFeatureEnabled, parseFlag } from "./features";

const getConfigValueMock = getConfigValue as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  getConfigValueMock.mockReset();
});

describe("parseFlag", () => {
  it('treats only the exact string "true" as on', () => {
    expect(parseFlag("true", false)).toBe(true);
    expect(parseFlag("false", true)).toBe(false);
  });

  // A flag gating data that leaves the org fails closed on a typo, never open.
  it.each(["", " ", "1", "yes", "TRUE", "on", "enabled"])("falls back on %o rather than guessing", (raw) => {
    expect(parseFlag(raw, false)).toBe(false);
    expect(parseFlag(raw, true)).toBe(true);
  });
});

describe("exports", () => {
  it("is off by default, with no Config row", async () => {
    expect(defaultFor("exports")).toBe(false);
    getConfigValueMock.mockResolvedValue("");
    expect(await isFeatureEnabled("org-1", "exports")).toBe(false);
  });

  it("reads Config.EXPORTS_ENABLED", async () => {
    getConfigValueMock.mockResolvedValue("true");
    expect(await isFeatureEnabled("org-1", "exports")).toBe(true);
    expect(getConfigValueMock).toHaveBeenCalledWith("org-1", "EXPORTS_ENABLED", "");
  });

  it("turns back off when the row is set to false", async () => {
    getConfigValueMock.mockResolvedValue("false");
    expect(await isFeatureEnabled("org-1", "exports")).toBe(false);
  });

  // The settings action writes through this, so a rename can't silently split
  // the key the form writes from the key the guards read.
  it("exposes the Config key the settings form writes", () => {
    expect(configKeyFor("exports")).toBe("EXPORTS_ENABLED");
  });
});

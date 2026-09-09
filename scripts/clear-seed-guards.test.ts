import { describe, expect, it } from "vitest";
import { assertConfirmed, assertProductionAllowed, ClearSeedRefused } from "./clear-seed-guards";

describe("assertConfirmed", () => {
  it("throws ClearSeedRefused when not confirmed", () => {
    expect(() => assertConfirmed(false)).toThrow(ClearSeedRefused);
  });

  it("does not throw when confirmed", () => {
    expect(() => assertConfirmed(true)).not.toThrow();
  });
});

describe("assertProductionAllowed", () => {
  it("allows a non-production NODE_ENV with no override set", () => {
    expect(() => assertProductionAllowed("development", undefined)).not.toThrow();
    expect(() => assertProductionAllowed(undefined, undefined)).not.toThrow();
  });

  it("refuses NODE_ENV=production when CLEAR_SEED_ALLOW_PRODUCTION is not set", () => {
    expect(() => assertProductionAllowed("production", undefined)).toThrow(ClearSeedRefused);
  });

  it("refuses NODE_ENV=production even when the override is set to something other than the literal string \"true\"", () => {
    expect(() => assertProductionAllowed("production", "1")).toThrow(ClearSeedRefused);
    expect(() => assertProductionAllowed("production", "yes")).toThrow(ClearSeedRefused);
  });

  it("allows NODE_ENV=production when CLEAR_SEED_ALLOW_PRODUCTION=true is explicitly set", () => {
    expect(() => assertProductionAllowed("production", "true")).not.toThrow();
  });
});

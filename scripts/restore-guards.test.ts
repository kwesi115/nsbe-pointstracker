import { describe, expect, it } from "vitest";
import { assertConfirmed, assertTargetAllowed, RestoreRefused } from "./restore-guards";

describe("assertConfirmed", () => {
  it("throws RestoreRefused when not confirmed", () => {
    expect(() => assertConfirmed(false)).toThrow(RestoreRefused);
  });

  it("does not throw when confirmed", () => {
    expect(() => assertConfirmed(true)).not.toThrow();
  });
});

describe("assertTargetAllowed — restore script refuses to run against a remote DATABASE_URL without the flag", () => {
  it("allows a localhost DATABASE_URL with no RESTORE_ALLOW_REMOTE set", () => {
    expect(() => assertTargetAllowed("postgresql://user:pw@localhost:5432/db", undefined)).not.toThrow();
  });

  it("allows 127.0.0.1 as an equivalent to localhost", () => {
    expect(() => assertTargetAllowed("postgresql://user:pw@127.0.0.1:5432/db", undefined)).not.toThrow();
  });

  it("refuses a remote DATABASE_URL when RESTORE_ALLOW_REMOTE is not set", () => {
    expect(() => assertTargetAllowed("postgresql://user:pw@prod-db.example.com:5432/db", undefined)).toThrow(RestoreRefused);
  });

  it("refuses a remote DATABASE_URL even when RESTORE_ALLOW_REMOTE is set to something other than the literal string \"true\"", () => {
    expect(() => assertTargetAllowed("postgresql://user:pw@prod-db.example.com:5432/db", "1")).toThrow(RestoreRefused);
    expect(() => assertTargetAllowed("postgresql://user:pw@prod-db.example.com:5432/db", "yes")).toThrow(RestoreRefused);
  });

  it("allows a remote DATABASE_URL when RESTORE_ALLOW_REMOTE=true is explicitly set", () => {
    expect(() => assertTargetAllowed("postgresql://user:pw@prod-db.example.com:5432/db", "true")).not.toThrow();
  });
});

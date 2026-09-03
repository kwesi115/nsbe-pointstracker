import { describe, expect, it } from "vitest";
import {
  generateSetupCode,
  hashPassword,
  validatePasswordStrength,
  verifyPassword,
} from "./passwords";

describe("hashPassword / verifyPassword", () => {
  it("round-trips: hash then verify succeeds for the right password", async () => {
    const hash = await hashPassword("a-fairly-decent-passphrase");
    await expect(verifyPassword("a-fairly-decent-passphrase", hash)).resolves.toBe(true);
  });

  it("fails for the wrong password", async () => {
    const hash = await hashPassword("a-fairly-decent-passphrase");
    await expect(verifyPassword("something-else-entirely", hash)).resolves.toBe(false);
  });

  it("returns false (never throws) for a blank or undefined hash", async () => {
    await expect(verifyPassword("whatever", "")).resolves.toBe(false);
    await expect(verifyPassword("whatever", undefined)).resolves.toBe(false);
    await expect(verifyPassword("whatever", null)).resolves.toBe(false);
  });
});

describe("generateSetupCode", () => {
  it("is 8 characters", () => {
    expect(generateSetupCode()).toHaveLength(8);
  });

  it("only draws from the ambiguity-free alphabet (no O/0/I/1)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateSetupCode();
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
      expect(code).not.toMatch(/[O0I1]/);
    }
  });

  it("1000 generated codes are all unique", () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateSetupCode());
    }
    expect(codes.size).toBe(1000);
  });
});

describe("validatePasswordStrength", () => {
  it("rejects 9 characters", () => {
    expect(validatePasswordStrength("abcdefghi").ok).toBe(false);
  });

  it("accepts 10 characters", () => {
    expect(validatePasswordStrength("abcdefghij").ok).toBe(true);
  });

  it("rejects a blocklisted phrase even when long enough", () => {
    const result = validatePasswordStrength("mypassword123");
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  it("rejects blocklisted phrases case-insensitively", () => {
    expect(validatePasswordStrength("HOWARD-bison-2026").ok).toBe(false);
  });
});

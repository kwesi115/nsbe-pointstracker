import { beforeAll, describe, expect, it } from "vitest";
import { generateSetupCode } from "./passwords";
import { normalizeSetupCode, openSetupCode, sealSetupCode, setupCodeMatches } from "./setup-code";

beforeAll(() => {
  process.env.CODE_SECRET ??= "test-code-secret";
});

describe("setupCodeMatches — forgiving about how the code was typed", () => {
  const CODE = "ABCD2345";

  it("accepts the exact code", () => {
    expect(setupCodeMatches(CODE, sealSetupCode(CODE))).toBe(true);
  });

  it("accepts different casing", () => {
    const sealed = sealSetupCode(CODE);
    expect(setupCodeMatches("abcd2345", sealed)).toBe(true);
    expect(setupCodeMatches("aBcD2345", sealed)).toBe(true);
  });

  it("accepts surrounding whitespace — a copy-paste or mobile keyboard's trailing space", () => {
    const sealed = sealSetupCode(CODE);
    expect(setupCodeMatches(" ABCD2345 ", sealed)).toBe(true);
    expect(setupCodeMatches("\tabcd2345\n", sealed)).toBe(true);
    expect(setupCodeMatches(" ABCD2345​", sealed)).toBe(true);
  });

  it("accepts the code with hyphens and spaces stripped", () => {
    const sealed = sealSetupCode(CODE);
    expect(setupCodeMatches("ABCD-2345", sealed)).toBe(true);
    expect(setupCodeMatches("abcd 2345", sealed)).toBe(true);
    expect(setupCodeMatches("ab-cd 23-45", sealed)).toBe(true);
    // Autocorrect turns a typed hyphen into an en dash.
    expect(setupCodeMatches("ABCD–2345", sealed)).toBe(true);
  });

  it("still rejects a wrong code", () => {
    const sealed = sealSetupCode(CODE);
    for (const wrong of ["ABCD2346", "ABCD234", "ABCD23455", "", "   ", "--"]) {
      expect(setupCodeMatches(wrong, sealed)).toBe(false);
    }
  });

  it("rejects when there is no stored code, or it has been tampered with", () => {
    expect(setupCodeMatches(CODE, null)).toBe(false);
    const [v, iv, tag, ct] = sealSetupCode(CODE).split(".");
    const flipped = ct[0] === "A" ? `B${ct.slice(1)}` : `A${ct.slice(1)}`;
    expect(setupCodeMatches(CODE, [v, iv, tag, flipped].join("."))).toBe(false);
  });
});

describe("sealSetupCode / openSetupCode", () => {
  it("round-trips, and the stored value is not the plaintext", () => {
    const sealed = sealSetupCode("WXYZ6789");
    expect(sealed).not.toContain("WXYZ6789");
    expect(openSetupCode(sealed)).toBe("WXYZ6789");
  });

  it("seals the same code differently each time", () => {
    expect(sealSetupCode("WXYZ6789")).not.toBe(sealSetupCode("WXYZ6789"));
  });

  it("returns null under a different CODE_SECRET rather than garbage", () => {
    const original = process.env.CODE_SECRET;
    const sealed = sealSetupCode("WXYZ6789");
    process.env.CODE_SECRET = `${original}-rotated`;
    try {
      expect(openSetupCode(sealed)).toBeNull();
    } finally {
      process.env.CODE_SECRET = original;
    }
  });

  it("returns null for anything malformed", () => {
    for (const bad of [undefined, null, "", "ABCD2345", "v2.a.b.c", "v1.only.three"]) {
      expect(openSetupCode(bad)).toBeNull();
    }
  });
});

describe("generated codes", () => {
  it("never contain the ambiguous characters O, 0, I or 1, and survive normalization unchanged", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateSetupCode();
      expect(code).not.toMatch(/[O0I1]/);
      expect(normalizeSetupCode(code)).toBe(code);
    }
  });
});

import { describe, expect, it } from "vitest";
import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("lowercases", () => {
    expect(normalizeEmail("Person@Example.com")).toBe("person@example.com");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeEmail("  person@example.com  ")).toBe("person@example.com");
  });

  it("is idempotent", () => {
    const once = normalizeEmail(" Person@Example.com ");
    expect(normalizeEmail(once)).toBe(once);
  });
});

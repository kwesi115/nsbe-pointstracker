import { describe, expect, it } from "vitest";
import { pgConnectionString } from "./pg-connection";

describe("pgConnectionString", () => {
  it("strips Prisma's ?schema= query param, which libpq rejects", () => {
    const result = pgConnectionString("postgresql://nsbe:pw@localhost:5432/nsbe_pointstracker?schema=public");
    expect(result).not.toContain("schema");
    expect(result).toBe("postgresql://nsbe:pw@localhost:5432/nsbe_pointstracker");
  });

  it("leaves a URL with no query string unchanged", () => {
    const result = pgConnectionString("postgresql://nsbe:pw@localhost:5432/nsbe_pointstracker");
    expect(result).toBe("postgresql://nsbe:pw@localhost:5432/nsbe_pointstracker");
  });

  it("preserves other, libpq-recognized query params like sslmode", () => {
    const result = pgConnectionString("postgresql://nsbe:pw@host:5432/db?schema=public&sslmode=require");
    expect(result).toContain("sslmode=require");
    expect(result).not.toContain("schema");
  });
});

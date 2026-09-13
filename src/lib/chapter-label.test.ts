/**
 * The chapter is "Howard NSBE" — in the app, the seed, and the README. The
 * database half is prisma/migrations/20260913120000_rename_chapter_label.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../..");
const OLD_LABELS = ["Howard University Chapter", "Howard University NSBE"];
const THIS_FILE = "src/lib/chapter-label.test.ts";

function files(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    return entry.isDirectory() ? files(rel) : [rel];
  });
}

describe("the chapter label", () => {
  it("never uses the old long-form name", () => {
    const scanned = [...files("src"), "prisma/seed.ts", "prisma/seed.test.ts", "README.md"].filter((f) => f !== THIS_FILE);
    const hits = scanned.flatMap((file) => {
      const text = readFileSync(path.join(ROOT, file), "utf8");
      return OLD_LABELS.filter((label) => text.includes(label)).map((label) => `${file}: ${label}`);
    });
    expect(hits).toEqual([]);
  });

  it("is what the seed writes for a fresh database", () => {
    const seed = readFileSync(path.join(ROOT, "prisma/seed.ts"), "utf8");
    expect(seed).toContain('CHAPTER_NAME: "Howard NSBE"');
    expect(seed).toContain('name: "Howard NSBE"');
  });
});

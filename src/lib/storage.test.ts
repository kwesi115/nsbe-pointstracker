/**
 * Pure logic only — no HTTP, no auth. requireSession() (used by
 * POST /api/files) needs the Next.js request-scoped context that a plain
 * Vitest run doesn't have, so the security-critical decision — does a
 * sniffed mime match the allow-list for this kind — is tested directly here
 * instead of through the route handler. See lib/storage.ts resolveUploadType.
 */
import { randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { afterEach, describe, expect, it } from "vitest";
import { backupStorage, resolveUploadType } from "./storage";

describe("resolveUploadType", () => {
  it("accepts a real PNG for house_proof", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const sniffed = await fileTypeFromBuffer(png);
    expect(resolveUploadType("house_proof", sniffed?.mime)).toEqual({ mime: "image/png", extension: ".png" });
  });

  it("rejects a spoofed Content-Type — plain-text bytes claiming to be a PDF are never accepted", async () => {
    const fakePdf = Buffer.from("This is not actually a PDF, no matter what the request said.");
    const sniffed = await fileTypeFromBuffer(fakePdf);
    // The route never even looks at what the client claimed — only this sniffed result.
    expect(sniffed?.mime).not.toBe("application/pdf");
    expect(resolveUploadType("resume", sniffed?.mime)).toBeNull();
  });

  it("rejects a real PNG submitted as a resume — right bytes, wrong kind", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const sniffed = await fileTypeFromBuffer(png);
    expect(resolveUploadType("resume", sniffed?.mime)).toBeNull();
  });
});

describe("backupStorage (local-disk driver — BACKUP_STORAGE_DRIVER unset in tests)", () => {
  const prefix = `test-backups-${randomUUID()}/`;

  afterEach(async () => {
    const keys = await backupStorage.list(prefix);
    for (const key of keys) await backupStorage.delete(key);
  });

  it("put then read round-trips the exact bytes", async () => {
    const buffer = Buffer.from("gzipped-dump-bytes-not-really-but-close-enough", "utf8");
    const key = `${prefix}nsbe-test-org-2026-01-01T00-00-00-000Z.sql.gz`;
    await backupStorage.put(key, buffer);
    const read = await backupStorage.read(key);
    expect(read.equals(buffer)).toBe(true);
  });

  it("list returns keys under the given prefix, and nothing else", async () => {
    await backupStorage.put(`${prefix}a.sql.gz`, Buffer.from("a"));
    await backupStorage.put(`${prefix}b.sql.gz`, Buffer.from("b"));
    const otherPrefix = `test-backups-${randomUUID()}/`;
    await backupStorage.put(`${otherPrefix}c.sql.gz`, Buffer.from("c"));

    const keys = await backupStorage.list(prefix);
    expect(keys.sort()).toEqual([`${prefix}a.sql.gz`, `${prefix}b.sql.gz`]);

    await backupStorage.delete(`${otherPrefix}c.sql.gz`);
  });

  it("list on a prefix with nothing written returns an empty array, not an error", async () => {
    const emptyPrefix = `test-backups-${randomUUID()}/`;
    expect(await backupStorage.list(emptyPrefix)).toEqual([]);
  });

  it("delete removes the key — a subsequent list no longer includes it", async () => {
    const key = `${prefix}to-delete.sql.gz`;
    await backupStorage.put(key, Buffer.from("x"));
    expect(await backupStorage.list(prefix)).toContain(key);

    await backupStorage.delete(key);
    expect(await backupStorage.list(prefix)).not.toContain(key);
  });
});

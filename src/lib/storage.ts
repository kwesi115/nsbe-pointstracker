/**
 * File-byte storage, driver-agnostic. Never stores bytes in Postgres —
 * UploadedFile (prisma/schema.prisma) only ever holds a storageKey, which is
 * NOT a public URL. Bytes are only ever served back through
 * GET /api/files/[id], which owns the owner-or-EBOARD check.
 *
 * Dev: local disk under .uploads/ (gitignored). Prod: Vercel Blob, loaded
 * dynamically so dev/test/build never need Blob credentials.
 *
 * `storage`/`backupStorage` are lazy Proxies, not plain objects: driver
 * selection (and its throws — see selectStorageDriver()/selectBackupDriver()
 * below) only runs on first property access, never at module scope. Both
 * modules are imported transitively by real routes (POST /api/files,
 * GET /api/admin/export/snapshot/[...key]) that Vercel's build imports
 * during page-data collection — a throw at module scope there would break
 * every build, since Vercel builds with NODE_ENV=production, which is
 * exactly the condition selectStorageDriver() checks for. See src/lib/prisma.ts
 * for the same pattern applied to the Prisma client.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileKind } from "./types";

export interface StoredFile {
  storageKey: string;
}

export interface StorageDriver {
  put(input: { buffer: Buffer; kind: FileKind; extension: string }): Promise<StoredFile>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
}

/**
 * Vercel sets NODE_ENV=production for preview AND production deployments, and
 * for the build itself — VERCEL_ENV narrows that to the real thing. Checking
 * either catches "deployed somewhere on Vercel" without depending on which
 * one a given host happens to set.
 */
function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

const UPLOADS_ROOT = path.resolve(process.cwd(), ".uploads");

const localDiskDriver: StorageDriver = {
  async put({ buffer, kind, extension }) {
    const dir = path.join(UPLOADS_ROOT, kind);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}${extension}`;
    await writeFile(path.join(dir, filename), buffer);
    return { storageKey: path.join(kind, filename) };
  },
  async read(storageKey) {
    // storageKey is server-generated (randomUUID, never client input) — no
    // path traversal surface, but resolve+contain defensively anyway.
    const resolved = path.resolve(UPLOADS_ROOT, storageKey);
    if (!resolved.startsWith(UPLOADS_ROOT)) throw new Error("Invalid storage key");
    return readFile(resolved);
  },
  async delete(storageKey) {
    const resolved = path.resolve(UPLOADS_ROOT, storageKey);
    if (!resolved.startsWith(UPLOADS_ROOT)) throw new Error("Invalid storage key");
    const { unlink } = await import("node:fs/promises");
    try {
      await unlink(resolved);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  },
};

/**
 * `access: "private"` — resumes carry addresses/phone numbers, House
 * screenshots carry names. A private blob's url/downloadUrl are not fetchable
 * by a plain unauthenticated GET; @vercel/blob's `get()` re-signs the request
 * with BLOB_READ_WRITE_TOKEN, and that call only ever happens from
 * GET /api/files/[id] after its own owner-or-EBOARD check. storageKey is the
 * pathname we chose (never the full blob URL), same shape as the local
 * driver's `kind/filename` key.
 */
const vercelBlobDriver: StorageDriver = {
  async put({ buffer, kind, extension }) {
    const { put } = await import("@vercel/blob");
    const pathname = `${kind}/${randomUUID()}${extension}`;
    await put(pathname, buffer, { access: "private", addRandomSuffix: false });
    return { storageKey: pathname };
  },
  async read(storageKey) {
    const { get } = await import("@vercel/blob");
    const result = await get(storageKey, { access: "private" });
    if (!result) throw new Error(`Blob not found: ${storageKey}`);
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  },
  async delete(storageKey) {
    const { del } = await import("@vercel/blob");
    await del(storageKey);
  },
};

const VALID_STORAGE_DRIVERS = ["local", "vercel-blob"] as const;

/**
 * Throws on anything but a value from VALID_STORAGE_DRIVERS, and throws if
 * the resolved driver is "local" while running in production — a missing
 * STORAGE_DRIVER resolves to "local" too, so it hits the same guard rather
 * than silently writing to a filesystem that's read-only on Vercel (the
 * ENOENT this exists to prevent). Never called at module scope — see the
 * Proxy below.
 */
function selectStorageDriver(): StorageDriver {
  const raw = process.env.STORAGE_DRIVER;
  const name = raw ?? "local";

  if (!(VALID_STORAGE_DRIVERS as readonly string[]).includes(name)) {
    throw new Error(`Unrecognized STORAGE_DRIVER "${raw}". Valid values: ${VALID_STORAGE_DRIVERS.join(", ")}.`);
  }

  if (name === "local" && isProductionRuntime()) {
    throw new Error(
      `STORAGE_DRIVER is "local"${raw ? "" : " (unset, which defaults to local)"} in a production environment ` +
        `(NODE_ENV or VERCEL_ENV is "production"). The local-disk driver writes to a read-only filesystem on ` +
        `Vercel and will fail. Set STORAGE_DRIVER=vercel-blob. Valid values: ${VALID_STORAGE_DRIVERS.join(", ")}.`,
    );
  }

  return name === "vercel-blob" ? vercelBlobDriver : localDiskDriver;
}

let cachedStorage: StorageDriver | undefined;

export const storage: StorageDriver = new Proxy({} as StorageDriver, {
  get(_target, prop, receiver) {
    cachedStorage ??= selectStorageDriver();
    return Reflect.get(cachedStorage, prop, receiver);
  },
});

// ---------------------------------------------------------------------------
// Backup/snapshot storage — deliberately a SEPARATE driver and env var
// (BACKUP_STORAGE_DRIVER, not STORAGE_DRIVER) from the user-upload storage
// above, so a backup bucket can never be accidentally pointed at the same
// place as house-proof/resume uploads (or vice versa). Backups and season
// snapshots hold every member's personal data — the bucket must NOT be
// public, unlike vercelBlobDriver's private-but-app-managed blobs above.
// writeSeasonSnapshot() (lib/export/snapshot.ts) runs both from the manual
// /admin/exports action AND automatically before destructive admin actions —
// it's a live request path, not just an offline ops script, so it needs the
// exact same "never silently write to disk in production" guard as uploads.
// ---------------------------------------------------------------------------

export interface BackupStorageDriver {
  put(key: string, buffer: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  /** Keys under `prefix`, for retention pruning (backups) and listing prior snapshots. */
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

const BACKUPS_ROOT = path.resolve(process.cwd(), ".backups");

/**
 * Dev/test fallback — same shape as the local-disk upload driver above, used
 * automatically whenever BACKUP_STORAGE_DRIVER isn't "s3" (no cloud
 * credentials needed to run backup/restore locally or in tests). NOT what a
 * real deployment should use for its nightly backups (a laptop's disk is not
 * a backup target) — see docs/RECOVERY.md.
 */
const localBackupDriver: BackupStorageDriver = {
  async put(key, buffer) {
    const dest = path.resolve(BACKUPS_ROOT, key);
    if (!dest.startsWith(BACKUPS_ROOT)) throw new Error("Invalid backup key");
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, buffer);
  },
  async read(key) {
    const dest = path.resolve(BACKUPS_ROOT, key);
    if (!dest.startsWith(BACKUPS_ROOT)) throw new Error("Invalid backup key");
    return readFile(dest);
  },
  async list(prefix) {
    const dir = path.resolve(BACKUPS_ROOT, prefix);
    if (!dir.startsWith(BACKUPS_ROOT)) throw new Error("Invalid backup prefix");
    const { readdir } = await import("node:fs/promises");
    try {
      const entries = await readdir(dir);
      return entries.map((e) => path.posix.join(prefix, e));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  },
  async delete(key) {
    const dest = path.resolve(BACKUPS_ROOT, key);
    if (!dest.startsWith(BACKUPS_ROOT)) throw new Error("Invalid backup key");
    const { unlink } = await import("node:fs/promises");
    await unlink(dest);
  },
};

/**
 * S3-compatible driver (real AWS S3 or Cloudflare R2's S3-compatible API) —
 * the actual production target. Bucket must be provisioned with NO public
 * access/public-read policy; this driver never sets an ACL that would make
 * one, unlike a public bucket would. Reads BACKUP_S3_ENDPOINT (omit for real
 * AWS S3, set for R2), BACKUP_S3_BUCKET, BACKUP_S3_REGION,
 * BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY.
 * @aws-sdk/client-s3 is loaded dynamically so dev/test/build never need it
 * installed unless this branch actually runs — same reasoning as
 * vercelBlobDriver's dynamic `@vercel/blob` import above.
 */
const s3BackupDriver: BackupStorageDriver = {
  async put(key, buffer) {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = s3Client(S3Client);
    await client.send(new PutObjectCommand({ Bucket: requireEnv("BACKUP_S3_BUCKET"), Key: key, Body: buffer }));
  },
  async read(key) {
    const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = s3Client(S3Client);
    const res = await client.send(new GetObjectCommand({ Bucket: requireEnv("BACKUP_S3_BUCKET"), Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  },
  async list(prefix) {
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = s3Client(S3Client);
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const res = await client.send(
        new ListObjectsV2Command({ Bucket: requireEnv("BACKUP_S3_BUCKET"), Prefix: prefix, ContinuationToken: continuationToken }),
      );
      for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
      continuationToken = res.NextContinuationToken;
    } while (continuationToken);
    return keys;
  },
  async delete(key) {
    const { S3Client, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = s3Client(S3Client);
    await client.send(new DeleteObjectCommand({ Bucket: requireEnv("BACKUP_S3_BUCKET"), Key: key }));
  },
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- S3Client's constructor type is only known once the dynamic import above resolves.
function s3Client(S3Client: any) {
  return new S3Client({
    region: process.env.BACKUP_S3_REGION || "auto",
    endpoint: process.env.BACKUP_S3_ENDPOINT || undefined,
    credentials: {
      accessKeyId: requireEnv("BACKUP_S3_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("BACKUP_S3_SECRET_ACCESS_KEY"),
    },
  });
}

const VALID_BACKUP_STORAGE_DRIVERS = ["local", "s3"] as const;

/** Same shape as selectStorageDriver() above — see that function's doc comment. Never called at module scope. */
function selectBackupDriver(): BackupStorageDriver {
  const raw = process.env.BACKUP_STORAGE_DRIVER;
  const name = raw ?? "local";

  if (!(VALID_BACKUP_STORAGE_DRIVERS as readonly string[]).includes(name)) {
    throw new Error(
      `Unrecognized BACKUP_STORAGE_DRIVER "${raw}". Valid values: ${VALID_BACKUP_STORAGE_DRIVERS.join(", ")}.`,
    );
  }

  if (name === "local" && isProductionRuntime()) {
    throw new Error(
      `BACKUP_STORAGE_DRIVER is "local"${raw ? "" : " (unset, which defaults to local)"} in a production ` +
        `environment (NODE_ENV or VERCEL_ENV is "production"). The local-disk driver writes to a read-only ` +
        `filesystem on Vercel and will fail. Set BACKUP_STORAGE_DRIVER=s3. Valid values: ${VALID_BACKUP_STORAGE_DRIVERS.join(", ")}.`,
    );
  }

  return name === "s3" ? s3BackupDriver : localBackupDriver;
}

let cachedBackupStorage: BackupStorageDriver | undefined;

export const backupStorage: BackupStorageDriver = new Proxy({} as BackupStorageDriver, {
  get(_target, prop, receiver) {
    cachedBackupStorage ??= selectBackupDriver();
    return Reflect.get(cachedBackupStorage, prop, receiver);
  },
});

export const ALLOWED_MIME_BY_KIND: Record<FileKind, { mime: string; extension: string }[]> = {
  house_proof: [
    { mime: "image/png", extension: ".png" },
    { mime: "image/jpeg", extension: ".jpg" },
    { mime: "image/webp", extension: ".webp" },
  ],
  resume: [
    { mime: "application/pdf", extension: ".pdf" },
    { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: ".docx" },
    { mime: "application/msword", extension: ".doc" },
    { mime: "application/x-cfb", extension: ".doc" },
  ],
};

/**
 * The client's declared Content-Type/extension is never trusted — only the
 * sniffed mime (from `file-type`'s magic-byte detection, see
 * POST /api/files) reaches this function. Pure, so a spoofed-Content-Type
 * upload is directly testable with no HTTP/auth involved.
 */
export function resolveUploadType(kind: FileKind, sniffedMime: string | undefined): { mime: string; extension: string } | null {
  return ALLOWED_MIME_BY_KIND[kind].find((a) => a.mime === sniffedMime) ?? null;
}

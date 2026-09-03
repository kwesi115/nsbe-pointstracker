import { fileTypeFromBuffer } from "file-type";
import { NextResponse } from "next/server";
import { withApiErrors } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { createUploadedFile, getUserId } from "@/lib/repo";
import { assertNotUploadRateLimited, recordUploadAttempt } from "@/lib/rate-limit";
import { requireSession } from "@/lib/session";
import { resolveUploadType, storage } from "@/lib/storage";
import type { FileKind } from "@/lib/types";

// Needs node:fs (the dev disk driver) and Buffer — not available on the edge runtime.
export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

function isFileKind(value: unknown): value is FileKind {
  return value === "resume" || value === "house_proof";
}

export const POST = withApiErrors(async (request: Request) => {
  const session = await requireSession();
  const userId = await getUserId(session.user.orgId, session.user.email);
  if (!userId) throw new AppError("UNAUTHENTICATED", "You must be signed in");

  assertNotUploadRateLimited(userId);

  const formData = await request.formData().catch(() => null);
  if (!formData) throw new AppError("VALIDATION_FAILED", "Invalid upload");

  const kindRaw = formData.get("kind");
  if (!isFileKind(kindRaw)) throw new AppError("VALIDATION_FAILED", "Invalid file kind");
  const kind = kindRaw;

  const files = formData.getAll("file");
  if (files.length !== 1 || !(files[0] instanceof File)) {
    throw new AppError("VALIDATION_FAILED", "Upload exactly one file");
  }
  const file = files[0] as File;

  if (file.size === 0) throw new AppError("VALIDATION_FAILED", "The file is empty");
  if (file.size > MAX_BYTES) throw new AppError("VALIDATION_FAILED", "Files must be 10MB or smaller");

  const buffer = Buffer.from(await file.arrayBuffer());

  // Sniff the actual bytes — never trust the client's declared Content-Type/extension.
  const sniffed = await fileTypeFromBuffer(buffer);
  const allowed = resolveUploadType(kind, sniffed?.mime);
  if (!allowed) {
    throw new AppError(
      "VALIDATION_FAILED",
      kind === "house_proof" ? "Upload a PNG, JPEG, or WEBP image." : "Upload a PDF or Word document.",
    );
  }

  recordUploadAttempt(userId);

  const stored = await storage.put({ buffer, kind, extension: allowed.extension });
  const uploaded = await createUploadedFile({
    orgId: session.user.orgId,
    userId,
    kind,
    storageKey: stored.storageKey,
    originalName: file.name || `upload${allowed.extension}`,
    mimeType: allowed.mime,
    sizeBytes: buffer.byteLength,
  });

  return NextResponse.json({ fileId: uploaded.id });
});

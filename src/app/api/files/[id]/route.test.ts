/**
 * GET /api/files/[id] — the only path by which file bytes reach a browser.
 *
 * Two things are being pinned here. The access rule (owner or EBOARD, and a 404
 * rather than a 403 for anyone else, so the endpoint never confirms a file
 * exists), and the audit trail: every view by someone who is not the owner
 * writes an AdminLog entry. That second one matters more now that House
 * screenshots are properly viewable — easier viewing means more viewing, and the
 * log is what keeps it accountable.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();
vi.mock("@/lib/session", () => ({ requireSession: () => requireSession() }));

const getUploadedFileForServing = vi.fn();
const logFileView = vi.fn();
vi.mock("@/lib/repo", async () => {
  // canAccessFile is the real rule — mocking it would test nothing.
  const actual = await vi.importActual<typeof import("@/lib/repo")>("@/lib/repo");
  return {
    canAccessFile: actual.canAccessFile,
    getUploadedFileForServing: (...args: unknown[]) => getUploadedFileForServing(...args),
    logFileView: (...args: unknown[]) => logFileView(...args),
  };
});

const read = vi.fn();
vi.mock("@/lib/storage", () => ({ storage: { read: (key: string) => read(key) } }));

import { GET } from "./route";

const OWNER = "ada@bison.howard.edu";
const FILE = {
  id: "file_1",
  kind: "house_proof" as const,
  mimeType: "image/png",
  sizeBytes: 68,
  originalName: "house-test-result.png",
  storageKey: "house_proof/abc.png",
  ownerEmail: OWNER,
  userId: "u1",
  createdAt: new Date("2026-09-01T00:00:00Z"),
};

function session(email: string, role: string) {
  return { user: { email, orgId: "org-1", role } };
}

function call(id = "file_1") {
  return GET(new Request(`http://localhost/api/files/${id}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  requireSession.mockReset().mockResolvedValue(session("eboard@bison.howard.edu", "eboard"));
  getUploadedFileForServing.mockReset().mockResolvedValue(FILE);
  logFileView.mockReset().mockResolvedValue(undefined);
  read.mockReset().mockResolvedValue(Buffer.from([1, 2, 3]));
});

describe("who can read a file", () => {
  it("serves the bytes to an EBOARD viewer, with the stored content type", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    // Never cached: the bytes are private and the check is per request.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(read).toHaveBeenCalledWith(FILE.storageKey);
  });

  it("serves the owner their own file", async () => {
    requireSession.mockResolvedValue(session(OWNER, "general"));
    expect((await call()).status).toBe(200);
  });

  it("serves an ADMIN viewer", async () => {
    requireSession.mockResolvedValue(session("admin@bison.howard.edu", "admin"));
    expect((await call()).status).toBe(200);
  });

  it("404s a non-owner, non-EBOARD request — and reads no bytes", async () => {
    requireSession.mockResolvedValue(session("someone-else@bison.howard.edu", "general"));
    const response = await call();
    expect(response.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });

  it("404s an unauthenticated request", async () => {
    requireSession.mockRejectedValue(new Error("unauthenticated"));
    expect((await call()).status).toBe(404);
  });

  it("404s a file that doesn't exist — never a 403, which would confirm it does", async () => {
    getUploadedFileForServing.mockResolvedValue(null);
    const response = await call("nope");
    expect(response.status).toBe(404);
  });

  it("is scoped to the session's org, so another org's file id is simply not found", async () => {
    await call();
    expect(getUploadedFileForServing).toHaveBeenCalledWith("org-1", "file_1");
  });
});

describe("the audit trail", () => {
  it("writes an AdminLog entry when someone who is not the owner views a file", async () => {
    await call();
    expect(logFileView).toHaveBeenCalledTimes(1);
    expect(logFileView).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        actor: "eboard@bison.howard.edu",
        fileId: "file_1",
        kind: "house_proof",
        ownerEmail: OWNER,
        originalName: "house-test-result.png",
      }),
    );
  });

  it("does NOT log the owner opening their own file — that is not an access event", async () => {
    requireSession.mockResolvedValue(session(OWNER, "general"));
    await call();
    expect(logFileView).not.toHaveBeenCalled();
  });

  it("compares owner and viewer normalized, so casing can't dodge the log either way", async () => {
    requireSession.mockResolvedValue(session("ADA@Bison.Howard.Edu", "general"));
    await call();
    expect(logFileView).not.toHaveBeenCalled();
  });

  it("logs before the bytes go out", async () => {
    const order: string[] = [];
    logFileView.mockImplementation(async () => void order.push("log"));
    read.mockImplementation(async () => {
      order.push("read");
      return Buffer.from([1]);
    });
    await call();
    expect(order).toEqual(["log", "read"]);
  });

  it("still serves the file if the log write fails — an audit gap beats blocking a verification", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    logFileView.mockRejectedValue(new Error("db down"));

    const response = await call();

    expect(response.status).toBe(200);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("logs nothing for a request that was refused", async () => {
    requireSession.mockResolvedValue(session("someone-else@bison.howard.edu", "general"));
    await call();
    expect(logFileView).not.toHaveBeenCalled();
  });
});

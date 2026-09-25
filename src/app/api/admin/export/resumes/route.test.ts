/**
 * POST /api/admin/export/resumes — the only path by which a bundle of members'
 * resumes leaves the system.
 *
 * Only the session is mocked. Role, grants, the EXPORTS_ENABLED flag, the
 * AdminLog entry and the ticket are all real reads and writes against the
 * Postgres at DATABASE_URL, because the thing under test IS the policy: which
 * callers get the bytes, and whether a download can happen without a record of
 * it. A mocked loadAdminAccess would test the mock.
 */

import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();
vi.mock("@/lib/session", () => ({ requireSession: () => requireSession() }));

import { Permission, Role, UserStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import {
  createResumeBundleRequest,
  getAdminLog,
  getResumeBundleRows,
  grantPermission,
  revokePermission,
  setConfigValue,
} from "@/lib/repo";
import { storage } from "@/lib/storage";
import { createTestOrg, TEST_SEASON, type TestOrg } from "@/test/db-fixtures";
import { POST } from "./route";

const RESUME_BYTES = Buffer.from("%PDF-1.7 resume\n");

let org: TestOrg;
let orgId: string;
const emails = {
  admin: "bundle-admin@bison.howard.edu",
  eboard: "bundle-eboard@bison.howard.edu",
  general: "bundle-general@bison.howard.edu",
};
const writtenKeys: string[] = [];

function session(email: string, role: string) {
  // The role on the token is deliberately a lie for some of these: the guard
  // re-reads it from the roster on every request, and that is the behaviour
  // worth pinning.
  return { user: { email, orgId, role, id: "x", status: "active", mustChangePassword: false } };
}

function call(body: unknown) {
  return POST(
    new Request("http://localhost/api/admin/export/resumes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function makeMemberWithResume(firstName: string, lastName: string) {
  const user = await prisma.user.create({
    data: {
      orgId,
      email: `${lastName.toLowerCase()}-${randomUUID().slice(0, 6)}@bison.howard.edu`,
      firstName,
      lastName,
      role: Role.GENERAL,
      status: UserStatus.ACTIVE,
      duesPaidReported: true,
      nationalMemberReported: true,
      membershipSeason: TEST_SEASON,
      signupCompletedAt: new Date(),
    },
  });
  const stored = await storage.put({ buffer: RESUME_BYTES, kind: "resume", extension: ".pdf" });
  writtenKeys.push(stored.storageKey);
  const file = await prisma.uploadedFile.create({
    data: {
      orgId,
      userId: user.id,
      kind: "RESUME",
      storageKey: stored.storageKey,
      originalName: "resume.pdf",
      mimeType: "application/pdf",
      sizeBytes: RESUME_BYTES.byteLength,
    },
  });
  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: { resumeFileId: file.id, resumeUpdatedAt: now, resumeConsentAt: now },
  });
  return user;
}

/** A live ticket for "everything", written the way the server action writes one. */
async function freshTicket(actor: string) {
  const token = randomUUID();
  const rows = await getResumeBundleRows(orgId, { kind: "all", filters: {} });
  await createResumeBundleRequest(orgId, {
    actor,
    requestToken: token,
    selection: { kind: "all", filters: {} },
    count: rows.length,
  });
  return token;
}

beforeAll(async () => {
  org = await createTestOrg("resume-route");
  orgId = org.orgId;
  await setConfigValue(orgId, "EXPORTS_ENABLED", "true", "system");

  for (const [role, email] of [
    [Role.ADMIN, emails.admin],
    [Role.EBOARD, emails.eboard],
    [Role.GENERAL, emails.general],
  ] as const) {
    await prisma.user.create({
      data: { orgId, email, firstName: "T", lastName: role, role, status: UserStatus.ACTIVE },
    });
  }

  await makeMemberWithResume("Ada", "Lovelace");
});

afterAll(async () => {
  await org.cleanup();
  await Promise.all(writtenKeys.map((k) => storage.delete(k).catch(() => undefined)));
});

beforeEach(() => {
  requireSession.mockReset();
});

describe("who can download a resume bundle", () => {
  it("refuses a GENERAL member, naming the permission they would need", async () => {
    requireSession.mockResolvedValue(session(emails.general, "general"));
    const response = await call({ ticket: "irrelevant" });
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.code).toBe("FORBIDDEN");
    expect(body.message).toContain("Resume access");
  });

  // The whole reason files_read is its own grant: reviewing a dues receipt is
  // ordinary officer work, walking off with every resume on the roster is not.
  it("refuses an EBOARD officer who has not been granted it", async () => {
    requireSession.mockResolvedValue(session(emails.eboard, "eboard"));
    const response = await call({ ticket: "irrelevant" });
    expect(response.status).toBe(403);
    expect((await response.json()).message).toContain("Resume access");
  });

  it("refuses a GENERAL member even if their token claims they are an admin", async () => {
    requireSession.mockResolvedValue(session(emails.general, "admin"));
    expect((await call({ ticket: "irrelevant" })).status).toBe(403);
  });

  it("lets an EBOARD officer through once the grant is in place, and refuses them again once it is revoked", async () => {
    requireSession.mockResolvedValue(session(emails.eboard, "eboard"));
    await grantPermission(orgId, emails.eboard, "files_read", emails.admin);
    try {
      // Through the access gate — the 422 is the ticket check beyond it.
      const allowed = await call({ ticket: "not-a-real-ticket" });
      expect(allowed.status).toBe(422);
    } finally {
      await revokePermission(orgId, emails.eboard, "files_read", emails.admin);
    }
    const refused = await call({ ticket: "not-a-real-ticket" });
    expect(refused.status).toBe(403);
  });

  it("stores the grant as FILES_READ", async () => {
    await grantPermission(orgId, emails.general, "files_read", emails.admin);
    const grant = await prisma.permissionGrant.findFirstOrThrow({
      where: { orgId, permission: Permission.FILES_READ, revokedAt: null },
    });
    expect(grant).toBeTruthy();
    await revokePermission(orgId, emails.general, "files_read", emails.admin);
  });

  it("refuses everyone, admin included, while the org's exports switch is off", async () => {
    requireSession.mockResolvedValue(session(emails.admin, "admin"));
    await setConfigValue(orgId, "EXPORTS_ENABLED", "false", "system");
    try {
      const response = await call({ ticket: "irrelevant" });
      expect(response.status).toBe(403);
      expect((await response.json()).message).toMatch(/turned off/i);
    } finally {
      await setConfigValue(orgId, "EXPORTS_ENABLED", "true", "system");
    }
  });
});

describe("no download without a ticket", () => {
  beforeEach(() => {
    requireSession.mockResolvedValue(session(emails.admin, "admin"));
  });

  it("refuses a missing, unknown or malformed ticket rather than streaming anyway", async () => {
    for (const body of [{}, { ticket: "" }, { ticket: randomUUID() }, { ticket: 7 }]) {
      const response = await call(body);
      expect(response.status).toBe(422);
      expect((await response.json()).message).toMatch(/expired/i);
    }
  });

  it("refuses a ticket that was logged for a different actor", async () => {
    const ticket = await freshTicket(emails.admin);
    await grantPermission(orgId, emails.eboard, "files_read", emails.admin);
    try {
      requireSession.mockResolvedValue(session(emails.eboard, "eboard"));
      const response = await call({ ticket });
      expect(response.status).toBe(422);
      // …and the original actor can still redeem it.
      requireSession.mockResolvedValue(session(emails.admin, "admin"));
      expect((await call({ ticket })).status).toBe(200);
    } finally {
      await revokePermission(orgId, emails.eboard, "files_read", emails.admin);
    }
  });

  it("streams the zip for a ticket the action already logged", async () => {
    const before = (await getAdminLog(orgId)).filter((e) => e.action === "download_resume_bundle").length;
    const ticket = await freshTicket(emails.admin);

    const response = await call({ ticket });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="nsbe-resumes-/);
    // A bundle of personal documents must never be cacheable by anything in between.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    // Streamed, so there is nothing to put in a Content-Length.
    expect(response.headers.get("Content-Length")).toBeNull();

    const zip = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(["Lovelace_Ada_Unspecified_Unspecified.pdf", "manifest.csv"]);

    // Exactly one entry for exactly one download.
    const after = (await getAdminLog(orgId)).filter((e) => e.action === "download_resume_bundle");
    expect(after).toHaveLength(before + 1);
    expect(after[0].actor).toBe(emails.admin);
  });
});

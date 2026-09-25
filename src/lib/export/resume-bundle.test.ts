/**
 * The bulk resume bundle, end to end against the real Postgres at DATABASE_URL
 * and the real local-disk storage driver under .uploads/.
 *
 * Storage is deliberately NOT mocked. "A resume whose blob is missing from
 * storage is skipped, noted, and does not fail the bundle" is only proven by a
 * file that genuinely is not on disk, and "the zip contains the right bytes" is
 * only proven by reading the archive back — which these tests do with fflate's
 * own unzip, so the writer is checked against an independent reader rather than
 * against itself.
 */

import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Classification, Role, UserStatus } from "@/generated/prisma/enums";
import { parseCsv } from "@/lib/csv";
import { prisma } from "@/lib/prisma";
import {
  createResumeBundleRequest,
  getAdminLog,
  getResumeBundleRows,
  getResumeBundleTicket,
  getResumeRoster,
  getResumeRosterCounts,
  removeResume,
  type ResumeBundleRow,
  type ResumeFilters,
} from "@/lib/repo";
import { storage } from "@/lib/storage";
import { createTestOrg, TEST_SEASON, type TestOrg } from "@/test/db-fixtures";
import {
  MANIFEST_FILENAME,
  MANIFEST_HEADER,
  MANIFEST_STATUS_LABEL,
  planResumeBundle,
  resumeFilenameFor,
  sanitizeSegment,
  streamResumeBundle,
} from "./resume-bundle";

const PDF = Buffer.from("%PDF-1.7\nnot really a pdf, but bytes are bytes\n");
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(" pretend docx")]);

const PDF_MIME = "application/pdf";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

let org: TestOrg;
let orgId: string;
/** Blobs this file actually wrote to disk, so afterAll can take them back out. */
const writtenKeys: string[] = [];

interface MakeResumeMember {
  firstName: string;
  lastName: string;
  classification?: Classification | null;
  major?: string | null;
  majorOther?: string | null;
  house?: string | null;
  eligible?: boolean;
  consent?: boolean;
  bytes?: Buffer;
  mime?: string;
  originalName?: string;
  /** Record the UploadedFile row but never write the blob — the orphaned-blob case. */
  skipBlob?: boolean;
  trashed?: boolean;
}

/** A live member with a resume attached, the way signup/`/account` leaves one. */
async function makeResumeMember(inOrg: string, input: MakeResumeMember) {
  const eligible = input.eligible ?? true;
  const user = await prisma.user.create({
    data: {
      orgId: inOrg,
      email: `${input.lastName.toLowerCase()}-${randomUUID().slice(0, 6)}@bison.howard.edu`,
      firstName: input.firstName,
      lastName: input.lastName,
      classification: input.classification ?? null,
      major: input.major ?? null,
      majorOther: input.majorOther ?? null,
      house: input.house ?? null,
      role: Role.GENERAL,
      status: UserStatus.ACTIVE,
      duesPaidReported: eligible,
      nationalMemberReported: eligible,
      nationalVerifiedAt: eligible ? new Date() : null,
      membershipSeason: eligible ? TEST_SEASON : null,
      signupCompletedAt: new Date(),
      // A User_trash_fields_check constraint keeps deletedAt and
      // permanentDeleteAt set or unset together — see the trash migration.
      ...(input.trashed
        ? {
            deletedAt: new Date(),
            permanentDeleteAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            deleteReason: "test",
          }
        : {}),
    },
  });

  const mime = input.mime ?? PDF_MIME;
  const bytes = input.bytes ?? PDF;
  const extension = mime === PDF_MIME ? ".pdf" : ".docx";

  let storageKey: string;
  if (input.skipBlob) {
    // A key in the right shape that was never written — exactly what an
    // orphaned UploadedFile row looks like after a blob is lost.
    storageKey = `resume/${randomUUID()}${extension}`;
  } else {
    const stored = await storage.put({ buffer: bytes, kind: "resume", extension });
    storageKey = stored.storageKey;
    writtenKeys.push(storageKey);
  }

  const file = await prisma.uploadedFile.create({
    data: {
      orgId: inOrg,
      userId: user.id,
      kind: "RESUME",
      storageKey,
      originalName: input.originalName ?? `resume${extension}`,
      mimeType: mime,
      sizeBytes: bytes.byteLength,
    },
  });

  const now = new Date();
  await prisma.user.update({
    where: { id: user.id },
    data: {
      resumeFileId: file.id,
      resumeUpdatedAt: now,
      resumeConsentAt: (input.consent ?? true) ? now : null,
    },
  });

  return { user, file };
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** The archive, read back with an independent unzip. */
async function unzipBundle(rows: ResumeBundleRow[]) {
  const { stream, filename } = streamResumeBundle(rows);
  const zip = await collect(stream);
  const entries = unzipSync(new Uint8Array(zip));
  const manifest = parseCsv(Buffer.from(entries[MANIFEST_FILENAME]).toString("utf8"));
  return { filename, entries, names: Object.keys(entries), manifest };
}

const NO_FILTERS: ResumeFilters = {};

beforeAll(async () => {
  org = await createTestOrg("resumes");
  orgId = org.orgId;
});

afterAll(async () => {
  await org.cleanup();
  await Promise.all(writtenKeys.map((k) => storage.delete(k).catch(() => undefined)));
});

// ---------------------------------------------------------------------------
// Filenames — pure, no database
// ---------------------------------------------------------------------------

describe("filename sanitizing", () => {
  it("reduces a name to ASCII, hyphenating inside a field", () => {
    expect(sanitizeSegment("Núñez")).toBe("Nunez");
    expect(sanitizeSegment("Electrical Engineering")).toBe("Electrical-Engineering");
    expect(sanitizeSegment("O'Brien-Smith")).toBe("O-Brien-Smith");
  });

  it("strips everything a filesystem could choke on, separators included", () => {
    expect(sanitizeSegment("../../etc/passwd")).toBe("etc-passwd");
    expect(sanitizeSegment('a:b*c?d"e<f>g|h')).toBe("a-b-c-d-e-f-g-h");
    expect(sanitizeSegment("trailing.  ")).toBe("trailing");
  });

  it("names an empty field rather than collapsing the four-part shape", () => {
    expect(sanitizeSegment("")).toBe("Unspecified");
    expect(sanitizeSegment("!!!")).toBe("Unspecified");
  });

  it("keeps the original extension per file type", () => {
    const base = {
      id: "1",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "a@bison.howard.edu",
      classification: "senior" as const,
      major: "Computer Science",
      majorOther: "",
      house: "Jemison",
      nationalMemberReported: true,
      nationalVerifiedAt: null,
      nationalRevokedAt: null,
      resumeUpdatedAt: null,
      resumeConsentAt: new Date(),
      storageKey: "k",
      originalName: "resume.pdf",
      sizeBytes: 1,
    };
    expect(resumeFilenameFor({ ...base, mimeType: PDF_MIME })).toBe("Lovelace_Ada_Senior_Computer-Science.pdf");
    expect(resumeFilenameFor({ ...base, mimeType: DOCX_MIME })).toBe("Lovelace_Ada_Senior_Computer-Science.docx");
    expect(resumeFilenameFor({ ...base, mimeType: "application/x-cfb" })).toBe(
      "Lovelace_Ada_Senior_Computer-Science.doc",
    );
  });
});

describe("de-duplication", () => {
  function rowFor(first: string, last: string, extra: Partial<ResumeBundleRow> = {}): ResumeBundleRow {
    return {
      id: randomUUID(),
      firstName: first,
      lastName: last,
      email: `${last}@bison.howard.edu`,
      classification: "junior",
      major: "Computer Engineering",
      majorOther: "",
      house: "Dean",
      nationalMemberReported: true,
      nationalVerifiedAt: null,
      nationalRevokedAt: null,
      resumeUpdatedAt: null,
      resumeConsentAt: new Date(),
      storageKey: "k",
      originalName: "resume.pdf",
      mimeType: PDF_MIME,
      sizeBytes: 1,
      ...extra,
    };
  }

  it("suffixes a repeat rather than letting one overwrite the other", () => {
    const names = planResumeBundle([
      rowFor("Jordan", "Baker"),
      rowFor("Jordan", "Baker"),
      rowFor("Jordan", "Baker"),
    ]).map((e) => e.filename);
    expect(names).toEqual([
      "Baker_Jordan_Junior_Computer-Engineering.pdf",
      "Baker_Jordan_Junior_Computer-Engineering_2.pdf",
      "Baker_Jordan_Junior_Computer-Engineering_3.pdf",
    ]);
    expect(new Set(names).size).toBe(3);
  });

  it("treats a case-only difference as a collision, because macOS and Windows do", () => {
    const names = planResumeBundle([rowFor("jordan", "baker"), rowFor("Jordan", "Baker")]).map((e) => e.filename);
    expect(names[0].toLowerCase()).not.toBe(names[1].toLowerCase());
  });

  // The four-part shape is what makes Windows' reserved device names
  // unreachable (see the note in resume-bundle.ts) — a member called Nul with
  // nothing else on file still gets three more segments after it.
  it("never produces a bare basename, even for an entirely empty profile", () => {
    const [entry] = planResumeBundle([
      rowFor("", "Nul", { classification: "", major: "", majorOther: "" }),
    ]);
    expect(entry.filename).toBe("Nul_Unspecified_Unspecified_Unspecified.pdf");
  });
});

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

describe("consent is the admission rule", () => {
  it("bundles the consenting resume and silently leaves out the one with no consent timestamp", async () => {
    const consenting = await makeResumeMember(orgId, { firstName: "Ada", lastName: "Consented" });
    const legacy = await makeResumeMember(orgId, { firstName: "Grace", lastName: "Nolegacy", consent: false });

    const rows = await getResumeBundleRows(orgId, { kind: "all", filters: NO_FILTERS });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(consenting.user.id);
    expect(ids).not.toContain(legacy.user.id);

    const { names } = await unzipBundle(rows);
    expect(names).toContain("Consented_Ada_Unspecified_Unspecified.pdf");
    expect(names.some((n) => n.startsWith("Nolegacy"))).toBe(false);
  });

  it("still LISTS the no-consent member, so the admin can see why the count differs", async () => {
    const roster = await getResumeRoster(orgId, NO_FILTERS);
    const legacy = roster.find((r) => r.lastName === "Nolegacy");
    expect(legacy).toBeDefined();
    expect(legacy!.resumeConsentAt).toBeNull();

    const counts = await getResumeRosterCounts(orgId);
    expect(counts.withResume).toBeGreaterThan(counts.withConsent);
  });

  it("drops a member out of the bundle the moment they remove their resume from /account", async () => {
    const leaving = await makeResumeMember(orgId, { firstName: "Mae", lastName: "Withdrawing" });
    const before = await getResumeBundleRows(orgId, { kind: "selected", memberIds: [leaving.user.id] });
    expect(before).toHaveLength(1);

    // The real /account path — removeResumeAction calls exactly this.
    await removeResume(orgId, leaving.user.email, leaving.user.email);

    const after = await getResumeBundleRows(orgId, { kind: "selected", memberIds: [leaving.user.id] });
    expect(after).toHaveLength(0);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: leaving.user.id } });
    expect(row.resumeConsentAt).toBeNull();
    expect(row.resumeFileId).toBeNull();
  });

  it("excludes a trashed member entirely, list and bundle alike", async () => {
    const trashed = await makeResumeMember(orgId, { firstName: "Otis", lastName: "Trashed", trashed: true });

    const rows = await getResumeBundleRows(orgId, { kind: "all", filters: NO_FILTERS });
    expect(rows.map((r) => r.id)).not.toContain(trashed.user.id);

    // Not even when named explicitly — the exclusion is in the query, not the caller.
    const named = await getResumeBundleRows(orgId, { kind: "selected", memberIds: [trashed.user.id] });
    expect(named).toHaveLength(0);

    const roster = await getResumeRoster(orgId, NO_FILTERS);
    expect(roster.map((r) => r.id)).not.toContain(trashed.user.id);
  });
});

// ---------------------------------------------------------------------------
// The archive
// ---------------------------------------------------------------------------

describe("the archive", () => {
  it("holds one file per row plus a manifest whose rows match the files present", async () => {
    const scoped = await createTestOrg("resumes-archive");
    try {
      await makeResumeMember(scoped.orgId, {
        firstName: "Ada",
        lastName: "Lovelace",
        classification: Classification.SENIOR,
        major: "Computer Science",
        house: "Jemison",
      });
      await makeResumeMember(scoped.orgId, {
        firstName: "Kwame",
        lastName: "Osei",
        classification: Classification.SOPHOMORE,
        major: "Other",
        majorOther: "Applied Math",
        house: "Latimer",
        mime: DOCX_MIME,
        bytes: DOCX,
      });
      const rows = await getResumeBundleRows(scoped.orgId, { kind: "all", filters: NO_FILTERS });

      const { entries, names, manifest, filename } = await unzipBundle(rows);

      expect(filename).toMatch(/^nsbe-resumes-\d{4}-\d{2}-\d{2}\.zip$/);
      expect(names.sort()).toEqual([
        "Lovelace_Ada_Senior_Computer-Science.pdf",
        MANIFEST_FILENAME,
        "Osei_Kwame_Sophomore_Applied-Math.docx",
      ].sort());

      // The bytes survive the round trip, not just the names.
      expect(Buffer.from(entries["Lovelace_Ada_Senior_Computer-Science.pdf"]).equals(PDF)).toBe(true);
      expect(Buffer.from(entries["Osei_Kwame_Sophomore_Applied-Math.docx"]).equals(DOCX)).toBe(true);

      expect(manifest[0]).toEqual([...MANIFEST_HEADER]);
      const filenamesInManifest = manifest.slice(1).map((r) => r[MANIFEST_HEADER.indexOf("Filename")]);
      expect(filenamesInManifest.sort()).toEqual(names.filter((n) => n !== MANIFEST_FILENAME).sort());

      const ada = manifest.slice(1).find((r) => r[0] === "Ada Lovelace")!;
      expect(ada[MANIFEST_HEADER.indexOf("Classification")]).toBe("Senior");
      expect(ada[MANIFEST_HEADER.indexOf("House")]).toBe("Jemison");
      expect(ada[MANIFEST_HEADER.indexOf("NSBE Membership Status")]).toBe("Verified");
      expect(ada[MANIFEST_HEADER.indexOf("Upload Date")]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(ada[MANIFEST_HEADER.indexOf("Status")]).toBe(MANIFEST_STATUS_LABEL.included);

      // "Other" is a sentinel, never a major — the manifest carries what the
      // member actually typed, same as the filename.
      const kwame = manifest.slice(1).find((r) => r[0] === "Kwame Osei")!;
      expect(kwame[MANIFEST_HEADER.indexOf("Major")]).toBe("Applied Math");
    } finally {
      await scoped.cleanup();
    }
  });

  it("skips a resume whose blob is gone, notes it as a failed row, and still produces a readable zip", async () => {
    const scoped = await createTestOrg("resumes-missing");
    try {
      await makeResumeMember(scoped.orgId, {
        firstName: "Ada",
        lastName: "Present",
        classification: Classification.JUNIOR,
      });
      await makeResumeMember(scoped.orgId, {
        firstName: "Ghost",
        lastName: "Missing",
        classification: Classification.JUNIOR,
        skipBlob: true,
      });
      const rows = await getResumeBundleRows(scoped.orgId, { kind: "all", filters: NO_FILTERS });
      expect(rows).toHaveLength(2);

      const { names, manifest } = await unzipBundle(rows);

      // The good one is there; the orphan is not; the archive still opened.
      expect(names).toContain("Present_Ada_Junior_Unspecified.pdf");
      expect(names.some((n) => n.startsWith("Missing_"))).toBe(false);
      expect(names).toContain(MANIFEST_FILENAME);

      const ghost = manifest.slice(1).find((r) => r[0] === "Ghost Missing")!;
      expect(ghost[MANIFEST_HEADER.indexOf("Status")]).toBe(MANIFEST_STATUS_LABEL.file_missing);
      // A failed row must not name a file the recruiter will go looking for.
      expect(ghost[MANIFEST_HEADER.indexOf("Filename")]).toBe("");

      const present = manifest.slice(1).find((r) => r[0] === "Ada Present")!;
      expect(present[MANIFEST_HEADER.indexOf("Status")]).toBe(MANIFEST_STATUS_LABEL.included);

      // Still the invariant that matters: every named file exists in the zip.
      const named = manifest
        .slice(1)
        .map((r) => r[MANIFEST_HEADER.indexOf("Filename")])
        .filter(Boolean);
      expect(named.sort()).toEqual(names.filter((n) => n !== MANIFEST_FILENAME).sort());
    } finally {
      await scoped.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

describe("every bulk download is recorded", () => {
  it("writes an AdminLog entry naming the actor, the count and the filters applied", async () => {
    const scoped = await createTestOrg("resumes-log");
    try {
      const actor = await prisma.user.create({
        data: {
          orgId: scoped.orgId,
          email: "recruiting-chair@bison.howard.edu",
          firstName: "Rec",
          lastName: "Chair",
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
        },
      });
      await makeResumeMember(scoped.orgId, { firstName: "Ada", lastName: "Senior", classification: Classification.SENIOR });
      await makeResumeMember(scoped.orgId, { firstName: "Sam", lastName: "Soph", classification: Classification.SOPHOMORE });

      const filters: ResumeFilters = { classification: "sophomore", major: "all", house: "all", eligible: "yes" };
      const rows = await getResumeBundleRows(scoped.orgId, { kind: "all", filters });
      expect(rows).toHaveLength(1);

      const token = randomUUID();
      const ticket = await createResumeBundleRequest(scoped.orgId, {
        actor: actor.email,
        requestToken: token,
        selection: { kind: "all", filters },
        count: rows.length,
      });
      expect(ticket.count).toBe(1);

      const log = await getAdminLog(scoped.orgId);
      const entry = log.find((e) => e.action === "download_resume_bundle");
      expect(entry).toBeDefined();
      expect(entry!.actor).toBe(actor.email);
      expect(entry!.target).toBe("resumes");
      expect(entry!.detail).toContain("1 resume(s)");
      expect(entry!.detail).toContain("classification=sophomore");
      expect(entry!.detail).toContain("eligible=yes");

      // The ticket carries the logged selection, so the route cannot stream a
      // different scope than the one on the log entry.
      const stored = await getResumeBundleTicket(scoped.orgId, token, actor.email);
      expect(stored).toEqual({ kind: "all", filters });
      // Bound to the actor it was logged for — another grant holder cannot
      // redeem it and leave the wrong name on the record.
      expect(await getResumeBundleTicket(scoped.orgId, token, "someone-else@bison.howard.edu")).toBeNull();
    } finally {
      await scoped.cleanup();
    }
  });

  it("records a hand-picked selection as such, and logs one entry per confirmation", async () => {
    const scoped = await createTestOrg("resumes-log-selected");
    try {
      const actor = await prisma.user.create({
        data: {
          orgId: scoped.orgId,
          email: "admin2@bison.howard.edu",
          firstName: "A",
          lastName: "Two",
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
        },
      });
      const a = await makeResumeMember(scoped.orgId, { firstName: "One", lastName: "Alpha" });
      const b = await makeResumeMember(scoped.orgId, { firstName: "Two", lastName: "Beta" });
      const selection = { kind: "selected" as const, memberIds: [a.user.id, b.user.id] };

      await createResumeBundleRequest(scoped.orgId, {
        actor: actor.email,
        requestToken: randomUUID(),
        selection,
        count: 2,
      });
      await createResumeBundleRequest(scoped.orgId, {
        actor: actor.email,
        requestToken: randomUUID(),
        selection,
        count: 2,
      });

      const log = await getAdminLog(scoped.orgId);
      const entries = log.filter((e) => e.action === "download_resume_bundle");
      expect(entries).toHaveLength(2);
      expect(entries[0].detail).toContain("2 hand-picked member(s)");
    } finally {
      await scoped.cleanup();
    }
  });

  it("refuses a repeat submission of the SAME confirmation, so one intent logs once", async () => {
    const scoped = await createTestOrg("resumes-log-double");
    try {
      const actor = await prisma.user.create({
        data: {
          orgId: scoped.orgId,
          email: "admin3@bison.howard.edu",
          firstName: "A",
          lastName: "Three",
          role: Role.ADMIN,
          status: UserStatus.ACTIVE,
        },
      });
      await makeResumeMember(scoped.orgId, { firstName: "Solo", lastName: "Member" });
      const selection = { kind: "all" as const, filters: NO_FILTERS };
      const token = randomUUID();

      await createResumeBundleRequest(scoped.orgId, { actor: actor.email, requestToken: token, selection, count: 1 });
      await expect(
        createResumeBundleRequest(scoped.orgId, { actor: actor.email, requestToken: token, selection, count: 1 }),
      ).rejects.toThrow();

      const log = await getAdminLog(scoped.orgId);
      expect(log.filter((e) => e.action === "download_resume_bundle")).toHaveLength(1);
    } finally {
      await scoped.cleanup();
    }
  });

  it("hands back nothing for a token that was never claimed", async () => {
    expect(await getResumeBundleTicket(orgId, randomUUID(), "anyone@bison.howard.edu")).toBeNull();
    expect(await getResumeBundleTicket(orgId, "", "anyone@bison.howard.edu")).toBeNull();
  });
});

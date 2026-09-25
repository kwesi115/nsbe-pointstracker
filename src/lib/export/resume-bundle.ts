/**
 * The recruiter-facing resume bundle: a zip of member resumes plus a
 * manifest.csv, generated on demand and streamed (see ./zip.ts).
 *
 * NOTHING IS PRE-BUILT OR CACHED. The bundle is derived from the roster at the
 * moment it is asked for, so a member who withdrew consent an hour ago is gone
 * from the next download with no invalidation step to forget. That is also why
 * it is not written to backup storage the way a season snapshot is: a snapshot
 * is a record the chapter keeps, a resume bundle is personal documents
 * leaving the system, and leaving copies of it lying in a bucket would
 * undo the consent rule this whole file is built around.
 *
 * CONSENT IS THE ONLY ADMISSION RULE. `resumeConsentAt` is written by the same
 * statement that writes `resumeFileId` and cleared by the same statement that
 * clears it (lib/repo.ts setResume / removeResume), so "has a resume" and "has
 * consented" move together and a member removing their resume from /account
 * drops out of the very next bundle. A row with a file but no consent
 * timestamp can only be legacy data; it is excluded silently from the zip and
 * loudly in the admin list, which is what stops "38 of 52" and the file count
 * disagreeing without explanation.
 */

import { toCsv } from "@/lib/csv";
import { CLAIM_STATE_LABEL, claimState } from "@/lib/claim-state";
import { formatClassification, formatMajor, memberDisplayName } from "@/lib/format";
import type { ResumeBundleRow } from "@/lib/repo";
import { ALLOWED_MIME_BY_KIND, storage } from "@/lib/storage";
import { createZipStream, type ZipEntry } from "./zip";

// ---------------------------------------------------------------------------
// Filenames
//
// LastName_FirstName_Classification_Major.pdf — underscores between the four
// parts, hyphens inside a part, so a recruiter sorting the folder by name gets
// the roster alphabetised by surname and can still read each field back out of
// the name unambiguously.
// ---------------------------------------------------------------------------

/** Long enough for "Electrical-Engineering", short enough that four of them plus separators clear every path limit. */
const MAX_SEGMENT = 40;

/** Stands in for a field the member never filled, so the four-part shape (and therefore the sort) survives a sparse profile. */
const MISSING_SEGMENT = "Unspecified";

/**
 * Names on this roster carry accents; zip readers, Windows and shell scripts
 * all handle them differently and some mangle them. Decomposing to NFD and
 * dropping the combining marks turns "Núñez" into "Nunez" — a lossy but
 * predictable ASCII form, which is what a filename needs to be.
 */
function toAscii(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Windows' reserved device names (CON, NUL, LPT1 …) are deliberately NOT
 * special-cased anywhere below, because the four-part shape makes them
 * unreachable: the rule applies to the basename up to its first dot, and every
 * name this module produces is four segments joined by underscores, so the
 * worst case is `Nul_Unspecified_Unspecified_Unspecified.pdf` — which is a
 * perfectly ordinary filename. A guard here would be unreachable code
 * pretending to be defence.
 */

/** One field of a filename, reduced to `[A-Za-z0-9-]`. Empty in, MISSING_SEGMENT out. */
export function sanitizeSegment(value: string): string {
  const cleaned = toAscii(value)
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SEGMENT)
    .replace(/-+$/g, "");
  return cleaned || MISSING_SEGMENT;
}

/**
 * The extension to give this entry.
 *
 * Driven by the sniffed mime type recorded at upload (POST /api/files never
 * trusts a client's declared type), so a .docx that arrived named "resume.pdf"
 * still lands in the bundle as .docx and opens. `application/x-cfb` is the
 * legacy Word container and maps to .doc, same as the upload allowlist.
 */
export function extensionForResume(mimeType: string, originalName: string): string {
  const known = ALLOWED_MIME_BY_KIND.resume.find((a) => a.mime === mimeType);
  if (known) return known.extension;
  // Unreachable for anything this app stored, but a hand-inserted row should
  // not silently become a .pdf that no reader can open.
  const fromName = /\.([A-Za-z0-9]{1,8})$/.exec(originalName);
  return fromName ? `.${fromName[1].toLowerCase()}` : ".bin";
}

/** The four-part name, before de-duplication. */
export function resumeFilenameFor(row: ResumeBundleRow): string {
  const parts = [
    sanitizeSegment(row.lastName),
    sanitizeSegment(row.firstName),
    sanitizeSegment(formatClassification(row.classification)),
    sanitizeSegment(formatMajor(row.major, row.majorOther)),
  ];
  return `${parts.join("_")}${extensionForResume(row.mimeType, row.originalName)}`;
}

export interface PlannedEntry {
  row: ResumeBundleRow;
  filename: string;
}

/**
 * Assigns every row a filename that is unique WITHIN THE BUNDLE.
 *
 * Two juniors both called Jordan Baker studying Computer Engineering is not a
 * hypothetical on a 270-person roster, and a zip holding the same name twice
 * either overwrites on extraction or errors, depending on the reader. Repeats
 * get `_2`, `_3` … before the extension.
 *
 * Collisions are detected case-INSENSITIVELY: macOS and Windows both treat
 * "baker_jordan.pdf" and "Baker_Jordan.pdf" as one file, so a bundle that only
 * deduped exactly would still lose a resume on the two platforms a recruiter
 * is most likely to be using.
 */
export function planResumeBundle(rows: ResumeBundleRow[]): PlannedEntry[] {
  const taken = new Set<string>();
  return rows.map((row) => {
    const base = resumeFilenameFor(row);
    const dot = base.lastIndexOf(".");
    const stem = dot > 0 ? base.slice(0, dot) : base;
    const ext = dot > 0 ? base.slice(dot) : "";
    let candidate = `${stem}${ext}`;
    for (let copy = 2; taken.has(candidate.toLowerCase()); copy++) {
      candidate = `${stem}_${copy}${ext}`;
    }
    taken.add(candidate.toLowerCase());
    return { row, filename: candidate };
  });
}

// ---------------------------------------------------------------------------
// manifest.csv
// ---------------------------------------------------------------------------

export const MANIFEST_FILENAME = "manifest.csv";

export const MANIFEST_HEADER = [
  "Name",
  "Bison Email",
  "Classification",
  "Major",
  "House",
  "NSBE Membership Status",
  "Upload Date",
  "Filename",
  "Status",
] as const;

/** What happened to one planned entry, which is the only thing the Status column reports. */
export type ManifestStatus = "included" | "file_missing";

export const MANIFEST_STATUS_LABEL: Record<ManifestStatus, string> = {
  included: "Included",
  file_missing: "File missing from storage — not in this bundle",
};

/**
 * ISO, not the app's usual "Sep 24, 2026".
 *
 * Every other export in lib/export uses formatDate/formatDateTime because a
 * human reads them top to bottom. This column exists to be SORTED and filtered
 * in a spreadsheet, and "Sep 24" sorts between "Oct" and "Nov" as text while
 * "2026-09-24" sorts correctly and is parsed as a date by Excel and Sheets
 * alike.
 */
function isoDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export function manifestRowFor(entry: PlannedEntry, status: ManifestStatus): string[] {
  const { row } = entry;
  return [
    memberDisplayName(row.firstName, row.lastName, row.email),
    row.email,
    formatClassification(row.classification),
    formatMajor(row.major, row.majorOther),
    row.house,
    CLAIM_STATE_LABEL[claimState(row.nationalMemberReported, row.nationalVerifiedAt, row.nationalRevokedAt)],
    isoDate(row.resumeUpdatedAt),
    // A row that isn't in the bundle must not name a file that isn't there.
    status === "included" ? entry.filename : "",
    MANIFEST_STATUS_LABEL[status],
  ];
}

// ---------------------------------------------------------------------------
// Caps
//
// NOT a memory limit. Measured on the real writer, peak heap held at ~23MB
// whether the archive came out at 48MB, 143MB or 191MB — the stream's high
// point is one file plus whatever the client has not drained, and it does not
// move with the bundle size.
//
// These are a WALL-CLOCK limit. Every entry costs a round trip to blob
// storage, and a serverless function that runs past its maxDuration (60s, see
// the route) dies mid-zip and hands the admin a truncated archive with no
// error, because the 200 has already gone out. 250 files at a pessimistic
// 150ms per read is ~38s, which leaves room for the transfer. Refusing up
// front with a sentence telling them to narrow the filters is the better
// failure.
//
// The browser is the second reason. The download is fetched and assembled
// into a Blob so the page can show real progress (see ResumesTable), which
// means the client holds the archive too — a cap that a function could survive
// but a laptop could not would just move the failure.
//
// Sized against the live roster: 113 resumes, 17.8MB, largest single file
// 2.4MB. Both caps sit well above that, so the whole chapter downloads in one
// go and the limits only bite on a roster far larger than any chapter this
// serves.
// ---------------------------------------------------------------------------

export const RESUME_BUNDLE_MAX_FILES = 250;
export const RESUME_BUNDLE_MAX_BYTES = 150 * 1024 * 1024;

export interface BundleLimitCheck {
  ok: boolean;
  message?: string;
}

export function checkBundleLimits(rows: ResumeBundleRow[]): BundleLimitCheck {
  if (rows.length > RESUME_BUNDLE_MAX_FILES) {
    return {
      ok: false,
      message: `That's ${rows.length} resumes — more than the ${RESUME_BUNDLE_MAX_FILES} a single bundle can generate before the request times out. Narrow the filters (by classification or major) and download in batches.`,
    };
  }
  const bytes = rows.reduce((sum, r) => sum + r.sizeBytes, 0);
  if (bytes > RESUME_BUNDLE_MAX_BYTES) {
    return {
      ok: false,
      message: `That's ${Math.round(bytes / (1024 * 1024))}MB of resumes — more than the ${Math.round(
        RESUME_BUNDLE_MAX_BYTES / (1024 * 1024),
      )}MB a single bundle can generate before the request times out. Narrow the filters and download in batches.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

export function resumeBundleFilename(now: Date = new Date()): string {
  return `nsbe-resumes-${isoDate(now)}.zip`;
}

/**
 * The zip, as a stream.
 *
 * manifest.csv is appended LAST, after every resume has been attempted, which
 * is what lets its Status column report what actually happened rather than
 * what was planned. Entry order inside a zip has no bearing on where a file
 * lands when it is extracted — manifest.csv is still at the root of the
 * folder, and every file manager sorts it into place — so paying for accuracy
 * with ordering costs nothing.
 *
 * A file whose blob has gone missing is skipped, recorded, and does not take
 * the download with it. The opposite behaviour — one 404 in object storage
 * failing a 113-resume bundle — is how a recruiting deadline gets missed over
 * a single orphaned row.
 */
export function streamResumeBundle(rows: ResumeBundleRow[]): {
  stream: ReadableStream<Uint8Array>;
  filename: string;
} {
  const planned = planResumeBundle(rows);

  async function* entries(): AsyncIterable<ZipEntry> {
    const manifest: string[][] = [];

    for (const entry of planned) {
      let source: AsyncIterable<Uint8Array>;
      try {
        source = await storage.readStream(entry.row.storageKey);
      } catch (err) {
        // Loud in the server log, invisible in the download except as a
        // manifest row — the admin gets a working zip and a record of the gap.
        console.error("resume bundle: blob missing, skipping", {
          memberId: entry.row.id,
          storageKey: entry.row.storageKey,
          err,
        });
        manifest.push(manifestRowFor(entry, "file_missing"));
        continue;
      }
      manifest.push(manifestRowFor(entry, "included"));
      yield { name: entry.filename, open: async () => source };
    }

    const csv = toCsv([[...MANIFEST_HEADER], ...manifest]);
    yield { name: MANIFEST_FILENAME, open: async () => [new TextEncoder().encode(csv)] };
  }

  return { stream: createZipStream(entries), filename: resumeBundleFilename() };
}

"use client";

import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
import { useRef, useState } from "react";
import {
  prepareResumeBundleAction,
  type ResumeBundleState,
} from "@/app/(member)/admin/resumes/actions";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import EmptyState from "@/components/ui/EmptyState";
import { HouseLabel } from "@/components/ui/HouseDot";
import { tdClass, thClass, Thead } from "@/components/ui/Table";
import { useToast } from "@/components/ui/Toast";
import { formatClassification, formatDate, formatFileSize, formatMajor, memberDisplayName } from "@/lib/format";
import type { House } from "@/lib/houses";
import type { ResumeFilters, ResumeRosterRow } from "@/lib/repo";

const INITIAL_STATE: ResumeBundleState = { error: null };

const BUNDLE_ENDPOINT = "/api/admin/export/resumes";

type Scope = "selected" | "all";

/** What the browser is doing after the dialog closed and the server said go. */
interface DownloadProgress {
  /** How many resumes the AdminLog entry was written for — the denominator the admin cares about. */
  count: number;
  bytes: number;
}

function filenameFromDisposition(header: string | null, fallback: string): string {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match ? match[1] : fallback;
}

export default function ResumesTable({
  rows,
  filters,
  houses,
  totalWithConsent,
}: {
  rows: ResumeRosterRow[];
  /** Echoed into the "Download all" submission, so the zip covers what the screen describes. */
  filters: ResumeFilters;
  houses: House[];
  /** Every consenting member in the org, unfiltered — the "Download all" copy needs to say whether filters narrow it. */
  totalWithConsent: number;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<Scope | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const { show } = useToast();

  // The client-side half of the double-submit guard, for the fetch that
  // happens AFTER the dialog closes: ConfirmDialog owns the action, but
  // nothing owns the download, and a second one would re-stream the same
  // ticket. (The server's guard is the RequestClaim row — see
  // repo.createResumeBundleRequest.)
  const downloadingRef = useRef(false);

  // A filter change re-renders the server component with fresh rows; drop a
  // selection that no longer matches rather than silently bundling members
  // who are no longer on screen.
  const [seed, setSeed] = useState(rows);
  if (seed !== rows) {
    setSeed(rows);
    setSelected(new Set());
  }

  // Only a member with consent on file can be bundled, so only they can be
  // picked. A disabled checkbox next to "No consent on file" answers "why is
  // the count lower than the list" without anyone having to ask.
  const selectableIds = rows.filter((r) => r.resumeConsentAt).map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function runDownload(ticket: string, count: number) {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setProgress({ count, bytes: 0 });
    try {
      const res = await fetch(BUNDLE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket }),
      });
      if (!res.ok) {
        // The route answers with JSON { code, message } for every refusal (see
        // lib/api.ts withApiErrors) — surface its own sentence, which says
        // whether the bundle was empty, oversized, or the ticket had expired.
        const body = await res.json().catch(() => null);
        show(typeof body?.message === "string" ? body.message : "The download failed.", "error");
        return;
      }

      const filename = filenameFromDisposition(res.headers.get("Content-Disposition"), "nsbe-resumes.zip");

      // Read the stream rather than await res.blob(), purely so the byte
      // counter below is real. The archive has no Content-Length (its size
      // isn't known until it's written), so bytes-received is the only honest
      // progress this can show — and it is enough to prove the thing is moving.
      let blob: Blob;
      if (res.body) {
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let received = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          chunks.push(value as unknown as BlobPart);
          received += value.byteLength;
          setProgress({ count, bytes: received });
        }
        blob = new Blob(chunks, { type: "application/zip" });
      } else {
        blob = await res.blob();
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      show(`Downloaded ${count} resume${count === 1 ? "" : "s"}`);
    } catch (err) {
      console.error(err);
      show("The download failed. Try again.", "error");
    } finally {
      downloadingRef.current = false;
      setProgress(null);
    }
  }

  function onPrepared(state: ResumeBundleState) {
    setScope(null);
    setSelected(new Set());
    // `count` is checked against undefined, not truthiness: the action never
    // hands back a ticket for an empty bundle, but a 0 slipping through as
    // falsy would skip the download and show nothing at all.
    if (state.ticket && state.count !== undefined) void runDownload(state.ticket, state.count);
  }

  const busy = progress !== null;
  const filtersNarrow = rows.filter((r) => r.resumeConsentAt).length !== totalWithConsent;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <p className="text-sm text-foreground">
          {selected.size > 0 ? `${selected.size} selected` : "Nothing selected"}
        </p>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            // Disabled, not hidden: the button is the affordance that teaches
            // the checkboxes exist.
            disabled={selected.size === 0 || busy}
            onClick={() => setScope("selected")}
          >
            <Download size={16} aria-hidden="true" /> Download selected
          </Button>
          <Button type="button" disabled={busy || selectableIds.length === 0} onClick={() => setScope("all")}>
            <Download size={16} aria-hidden="true" /> Download all
          </Button>
        </div>
      </div>

      {/* Generation plus transfer takes a few seconds on a full chapter, and a
          button that looks idle gets clicked again — so the bar stays up for
          the whole request, counting bytes as they land. */}
      {progress ? (
        <div
          role="status"
          aria-live="polite"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-foreground"
        >
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-signal" aria-hidden="true" />
          <span>
            Building a zip of {progress.count} resume{progress.count === 1 ? "" : "s"}…
          </span>
          <span className="numeric text-muted">{progress.bytes > 0 ? `${formatFileSize(progress.bytes)} received` : "starting"}</span>
        </div>
      ) : null}

      <ConfirmDialog<ResumeBundleState>
        open={scope === "selected"}
        title="Download selected resumes"
        description={
          <>
            {selected.size} member{selected.size === 1 ? "" : "s"} selected. The zip holds one file per resume plus a
            manifest.csv. Every download is recorded in the admin log with your name and the filters used.
          </>
        }
        confirmLabel="Download"
        action={prepareResumeBundleAction}
        initialState={INITIAL_STATE}
        payload={{ scope: "selected", memberIds: Array.from(selected).join(",") }}
        onCancel={() => setScope(null)}
        onSuccess={onPrepared}
      />

      <ConfirmDialog<ResumeBundleState>
        open={scope === "all"}
        title="Download all resumes"
        description={
          <>
            {filtersNarrow
              ? "Every resume matching the filters currently applied, with consent on file."
              : `All ${totalWithConsent} resumes with consent on file.`}{" "}
            The zip holds one file per resume plus a manifest.csv. Every download is recorded in the admin log with your
            name and the filters used.
          </>
        }
        confirmLabel="Download"
        action={prepareResumeBundleAction}
        initialState={INITIAL_STATE}
        // The filters travel with the submission, so the server bundles — and
        // logs — the same scope the screen is describing.
        payload={{
          scope: "all",
          q: filters.q ?? "",
          classification: filters.classification ?? "all",
          major: filters.major ?? "all",
          house: filters.house ?? "all",
          eligible: filters.eligible ?? "all",
        }}
        onCancel={() => setScope(null)}
        onSuccess={onPrepared}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No resumes match"
          description="No member with a resume on file matches these filters. Clear a filter, or widen the search."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full border-collapse text-sm">
            <Thead>
              <th className={`${thClass} w-10 pl-3`}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={selectableIds.length === 0}
                  aria-label="Select all members with consent on file"
                  className="h-4 w-4"
                />
              </th>
              <th className={`${thClass} min-w-[170px]`}>Name</th>
              <th className={`${thClass} min-w-[130px]`}>Classification</th>
              <th className={`${thClass} min-w-[150px]`}>Major</th>
              <th className={`${thClass} min-w-[140px]`}>House</th>
              <th className={`${thClass} min-w-[110px]`}>Uploaded</th>
              <th className={`${thClass} min-w-[90px]`}>Size</th>
              <th className={`${thClass} min-w-[170px]`}>Consent</th>
            </Thead>
            <tbody>
              {rows.map((row) => {
                const consented = Boolean(row.resumeConsentAt);
                return (
                  <tr key={row.id} className="border-b border-border last:border-0">
                    <td className={`${tdClass} pl-3`}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggle(row.id)}
                        disabled={!consented || busy}
                        aria-label={`Select ${memberDisplayName(row.firstName, row.lastName, row.email)}`}
                        className="h-4 w-4"
                      />
                    </td>
                    <td className={tdClass}>
                      <Link
                        href={`/admin/members/${row.id}`}
                        className="font-medium text-signal-strong underline underline-offset-2"
                      >
                        {memberDisplayName(row.firstName, row.lastName, row.email)}
                      </Link>
                      <div className="text-xs text-muted">{row.email}</div>
                    </td>
                    <td className={tdClass}>{formatClassification(row.classification) || "—"}</td>
                    <td className={tdClass}>{formatMajor(row.major, row.majorOther) || "—"}</td>
                    <td className={tdClass}>
                      <HouseLabel house={row.house} houses={houses} />
                    </td>
                    <td className={`${tdClass} numeric`}>{formatDate(row.resumeUpdatedAt)}</td>
                    <td className={`${tdClass} numeric`}>{formatFileSize(row.sizeBytes)}</td>
                    <td className={tdClass}>
                      {consented ? (
                        <span className="numeric text-muted">{formatDate(row.resumeConsentAt)}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-medium text-torch-strong">
                          <AlertTriangle size={14} aria-hidden="true" />
                          No consent on file
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

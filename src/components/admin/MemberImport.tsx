"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { commitImportAction, previewImportAction } from "@/app/(member)/admin/members/actions";
import { createSnapshotAction } from "@/app/(member)/admin/exports/actions";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { csvHeaderIndex, parseCsv, toCsv } from "@/lib/csv";
import type { BulkImportPreview, BulkImportRow } from "@/lib/repo";
import type { Role } from "@/lib/types";

function parseImportFile(text: string): BulkImportRow[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const idx = csvHeaderIndex(rows[0]);
  const emailCol = idx.get("email");
  const firstCol = idx.get("firstname") ?? idx.get("first name");
  const lastCol = idx.get("lastname") ?? idx.get("last name");
  const roleCol = idx.get("role");
  if (emailCol === undefined || firstCol === undefined || lastCol === undefined) {
    throw new Error("CSV must have email, firstName, and lastName columns.");
  }

  return rows.slice(1).map((r) => {
    const rawRole = (roleCol !== undefined ? r[roleCol] : "general").trim().toLowerCase();
    const role: Role = rawRole === "eboard" || rawRole === "guest" ? rawRole : "general";
    return {
      email: (r[emailCol] ?? "").trim(),
      firstName: (r[firstCol] ?? "").trim(),
      lastName: (r[lastCol] ?? "").trim(),
      role,
    };
  });
}

function downloadCsv(filename: string, rows: string[][]) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function MemberImport() {
  const [rows, setRows] = useState<BulkImportRow[] | null>(null);
  const [preview, setPreview] = useState<BulkImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { show } = useToast();

  async function handleFile(file: File) {
    setParseError(null);
    setPreview(null);
    try {
      const text = await file.text();
      const parsed = parseImportFile(text);
      setRows(parsed);
      setBusy(true);
      const result = await previewImportAction(parsed);
      setPreview(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Could not read that file.");
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleCommit() {
    if (!rows) return;
    setBusy(true);
    // Fire-and-forget — a slow snapshot shouldn't hang a bulk import, and a
    // snapshot failure shouldn't block it either (the nightly pg_dump is
    // still the real backup; this is the "one more safety net" layer).
    void createSnapshotAction(`before bulk import of ${rows.length} member(s)`).catch(() => {});
    try {
      const result = await commitImportAction(rows);
      show(`Imported ${result.created.length} member(s), skipped ${result.skipped}.`);
      if (result.created.length > 0) {
        downloadCsv(
          "nsbe-setup-codes.csv",
          [["email", "setupCode"], ...result.created.map((c) => [c.email, c.setupCode])],
        );
      }
      setRows(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      show(err instanceof Error ? err.message : "Import failed.", "error");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface-sunken">
          <Upload size={16} aria-hidden="true" />
          Upload CSV
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
        <span className="text-xs text-muted">Columns: email, firstName, lastName, role (optional)</span>
      </div>

      {parseError ? (
        <p role="alert" className="text-sm font-medium text-alert">
          {parseError}
        </p>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-ink">
              <strong className="numeric">{preview.toCreate.length}</strong> will be created,{" "}
              <strong className="numeric">{preview.toSkip.length}</strong> will be skipped.
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRows(null);
                  setPreview(null);
                  if (fileRef.current) fileRef.current.value = "";
                }}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => setConfirming(true)} disabled={busy || preview.toCreate.length === 0}>
                {busy ? "Importing…" : `Create ${preview.toCreate.length}`}
              </Button>
            </div>
          </div>

          {preview.toSkip.length > 0 ? (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer font-medium text-ink">Skipped rows</summary>
              <ul className="mt-2 flex flex-col gap-1">
                {preview.toSkip.map((s, i) => (
                  <li key={i}>
                    {s.row.email || "(blank)"} — {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={`Create ${preview?.toCreate.length ?? 0} member accounts?`}
        description="Each one gets a fresh setup code. You'll get a one-time CSV of those codes to hand out — it won't be shown again after this."
        confirmLabel="Create accounts"
        pending={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={handleCommit}
      />
    </div>
  );
}

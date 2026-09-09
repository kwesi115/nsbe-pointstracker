"use client";

import { FileText, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import Field from "@/components/ui/Field";

const MAX_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Uploads immediately on selection (via XHR, for real progress — fetch has no
 * upload-progress event) and reports back a fileId once POST /api/files
 * succeeds. The core-form/guest-form only ever submits that fileId, never
 * raw bytes.
 */
export default function FileDropField({
  label,
  help,
  kind,
  accept,
  required,
  error,
  filename,
  onUploaded,
  onClear,
  disabled,
}: {
  label: string;
  help?: string;
  kind: "resume" | "house_proof";
  accept: string;
  required?: boolean;
  error?: string | null;
  /** The currently-selected/uploaded filename, if any — lifted to the parent so it survives re-renders of this field. */
  filename: string | null;
  onUploaded: (fileId: string, filename: string) => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);

  function upload(file: File) {
    setLocalError(null);
    if (file.size > MAX_BYTES) {
      setLocalError("That file is larger than 10MB.");
      return;
    }
    setSizeBytes(file.size);

    const formData = new FormData();
    formData.append("kind", kind);
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onloadstart = () => {
      setUploading(true);
      setProgress(0);
    };
    xhr.onload = () => {
      setUploading(false);
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && body.fileId) {
          onUploaded(body.fileId, file.name);
        } else {
          setLocalError(body.message ?? "Couldn't upload that file. Try a different one.");
        }
      } catch {
        setLocalError("Couldn't upload that file. Try again.");
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setLocalError("Couldn't reach the server. Check your connection and try again.");
    };
    xhr.send(formData);
  }

  function handleFiles(files: FileList | null) {
    if (disabled || uploading) return;
    const file = files?.[0];
    if (file) upload(file);
  }

  function clear() {
    onClear();
    setLocalError(null);
    setProgress(0);
    setSizeBytes(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <Field label={label} help={help} error={error ?? localError} required={required}>
      {(id, describedBy) =>
        filename && !uploading ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5">
            <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
              <FileText size={16} className="shrink-0 text-muted" aria-hidden="true" />
              <span className="truncate">{filename}</span>
              {sizeBytes !== null ? <span className="numeric shrink-0 text-xs text-muted">{formatBytes(sizeBytes)}</span> : null}
            </span>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-sunken hover:text-ink"
              aria-label="Remove file"
            >
              <X size={16} />
            </button>
          </div>
        ) : (
          // The whole dashed box is the tap target on a phone (drag-and-drop
          // is a bonus for desktop, never the only way in) — a <label>
          // wrapping everything, not just the "Choose a file" text, opens the
          // native file input (photo library on iOS, Files/gallery picker on
          // Android) from anywhere in the box.
          <label
            htmlFor={id}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              handleFiles(e.dataTransfer.files);
            }}
            className={`flex min-h-24 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragOver ? "border-signal bg-signal/5" : "border-line bg-surface"
            }`}
          >
            <input
              ref={inputRef}
              id={id}
              type="file"
              accept={accept}
              disabled={disabled || uploading}
              onChange={(e) => handleFiles(e.target.files)}
              aria-describedby={describedBy}
              className="sr-only"
            />
            <Upload size={20} className="text-muted" aria-hidden="true" />
            {uploading ? (
              <div className="flex w-full max-w-40 flex-col gap-1">
                <p className="numeric text-xs text-muted">Uploading… {progress}%</p>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-signal transition-[width]" style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : (
              <span className="text-sm font-medium text-signal underline underline-offset-2">
                Choose a file
                <span className="block text-xs font-normal text-muted no-underline">or drag and drop — max 10MB</span>
              </span>
            )}
          </label>
        )
      }
    </Field>
  );
}

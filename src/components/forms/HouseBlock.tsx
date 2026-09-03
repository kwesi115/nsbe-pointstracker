"use client";

import { ExternalLink } from "lucide-react";
import FileDropField from "@/components/forms/FileDropField";
import Button from "@/components/ui/Button";
import Field, { selectClass } from "@/components/ui/Field";
import HouseDot from "@/components/ui/HouseDot";
import { coreField } from "@/lib/core-form";
import type { House } from "@/lib/houses";

export interface HouseBlockValue {
  house?: string;
  houseProofFileId?: string;
  houseFilename?: string;
  /** Explicit "I haven't taken the test yet" — the only other way through this block besides House + screenshot. */
  houseSkipped?: boolean;
}

/**
 * NSBE House — ONE component, three placements (the check-in form, /account,
 * and the signup wizard). No Yes/No question: the test link is the first
 * thing a member sees, then the House dropdown + screenshot upload, with an
 * explicit "I haven't taken the test yet" as the only other way through.
 * Selecting a House requires the screenshot and vice versa — the client-side
 * half of that rule; lib/core-form.ts buildCoreFormSchema and
 * lib/repo.ts setHouseAssignment enforce it server-side independently.
 */
export default function HouseBlock({
  houses,
  houseTestUrl,
  value,
  onChange,
  errors,
  disabled,
}: {
  houses: House[];
  houseTestUrl: string;
  value: HouseBlockValue;
  onChange: (patch: HouseBlockValue) => void;
  errors?: { house?: string; houseProofFileId?: string };
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Button href={houseTestUrl} target="_blank" rel="noopener noreferrer" className="self-start">
        Take the NSBE House Personality Test
        <ExternalLink size={14} aria-hidden="true" />
      </Button>

      {value.houseSkipped ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2.5 text-sm text-ink">
          <span>No problem — take the test when you get a chance. We&apos;ll ask again at your next event.</span>
          <button
            type="button"
            onClick={() => onChange({ houseSkipped: false })}
            disabled={disabled}
            className="shrink-0 text-xs font-semibold text-signal underline underline-offset-2"
          >
            Actually, I have a result
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">Already taken it? Upload a screenshot of your result below.</p>

          <Field label={coreField("house").label} required error={errors?.house}>
            {(id) => (
              <div className="flex items-center gap-2">
                <HouseDot color={houses.find((h) => h.name === value.house)?.color} />
                <select
                  id={id}
                  value={value.house ?? ""}
                  onChange={(e) => onChange({ house: e.target.value })}
                  disabled={disabled}
                  className={selectClass}
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {houses.map((h) => (
                    <option key={h.code} value={h.name}>
                      {h.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </Field>

          <FileDropField
            label={coreField("houseProofFileId").label}
            kind="house_proof"
            accept="image/png,image/jpeg,image/webp"
            required
            error={errors?.houseProofFileId}
            filename={value.houseFilename ?? null}
            onUploaded={(fileId, filename) => onChange({ houseProofFileId: fileId, houseFilename: filename })}
            onClear={() => onChange({ houseProofFileId: undefined, houseFilename: undefined })}
            disabled={disabled}
          />

          <button
            type="button"
            onClick={() => onChange({ houseSkipped: true, house: undefined, houseProofFileId: undefined, houseFilename: undefined })}
            disabled={disabled}
            className="self-start text-xs font-semibold text-muted underline underline-offset-2 hover:text-ink"
          >
            I haven&apos;t taken the test yet
          </button>
        </>
      )}
    </div>
  );
}

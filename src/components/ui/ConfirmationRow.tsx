import { CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

/** A confirmed answer — visually distinct from a live question everywhere it appears (check-in form, /account). onEdit, when given, expands this single field inline instead of asking the whole form again. */
export default function ConfirmationRow({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-sunken px-3 py-2.5 text-sm text-ink">
      <span className="flex items-center gap-2">
        <CheckCircle2 size={16} className="shrink-0 text-signal" aria-hidden="true" />
        <span>
          {label}: <strong className="font-semibold">{value}</strong>
        </span>
      </span>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-xs font-semibold text-signal underline underline-offset-2"
        >
          Edit
        </button>
      ) : null}
    </div>
  );
}

import { Check, Clock, X } from "lucide-react";

/** Muted em-dash for an empty/not-provided value — never a raw "—" literal in a data cell (screen readers get "Not provided" instead of silence). */
export function EmptyValue({ label = "Not provided" }: { label?: string }) {
  return (
    <span className="text-muted" aria-label={label}>
      —
    </span>
  );
}

/**
 * True/false/pending status glyph shared by the roster's Dues, National,
 * Eligible, House, and Resume columns — a raw checkmark/cross conveys nothing
 * to a screen reader, so every state carries its own aria-label.
 */
export default function StatusIcon({
  value,
  labels,
}: {
  value: boolean | null;
  labels?: { yes?: string; no?: string; pending?: string };
}) {
  if (value === null) {
    return <Clock size={16} className="text-[#7a4d00]" aria-label={labels?.pending ?? "Pending"} />;
  }
  if (value) {
    return <Check size={16} className="text-signal" aria-label={labels?.yes ?? "Yes"} />;
  }
  return <X size={16} className="text-muted" aria-label={labels?.no ?? "No"} />;
}

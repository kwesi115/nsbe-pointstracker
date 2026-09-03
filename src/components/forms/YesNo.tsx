/** Shared Yes/No radio pair — used by CoreCheckInForm and the signup wizard so both render the same control. */
export default function YesNo({
  id,
  label,
  value,
  onChange,
  error,
  describedBy,
}: {
  id: string;
  label: string;
  value: boolean | undefined;
  onChange: (v: boolean) => void;
  error?: string | null;
  describedBy?: string;
}) {
  return (
    <div className="flex gap-4" role="radiogroup" aria-label={label} aria-invalid={Boolean(error)} aria-describedby={describedBy}>
      {(["Yes", "No"] as const).map((opt) => (
        <label key={opt} className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name={id}
            checked={value === (opt === "Yes")}
            onChange={() => onChange(opt === "Yes")}
            className="h-4 w-4"
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

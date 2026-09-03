import type { ReactNode } from "react";

export type StatAccent = "ink" | "signal" | "amber" | "alert";

const ACCENT: Record<StatAccent, string> = {
  ink: "text-ink",
  signal: "text-signal",
  amber: "text-amber",
  alert: "text-alert",
};

/**
 * The numeral hero. Every value rendered here uses tabular-nums mono so a
 * row of stat tiles lines up, and so the number doesn't jitter if it updates
 * live (e.g. a registration count).
 */
export default function StatTile({
  label,
  value,
  sub,
  accent = "ink",
  size = "lg",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: StatAccent;
  size?: "lg" | "md";
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span
        className={`numeric ${size === "lg" ? "text-4xl" : "text-2xl"} font-semibold leading-none ${ACCENT[accent]}`}
      >
        {value}
      </span>
      {sub ? <span className="text-sm text-muted">{sub}</span> : null}
    </div>
  );
}

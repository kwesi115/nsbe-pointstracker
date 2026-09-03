export type BadgeTone = "ink" | "signal" | "amber" | "alert" | "muted";

const TONE: Record<BadgeTone, string> = {
  ink: "bg-ink text-white",
  signal: "bg-signal/10 text-signal",
  amber: "bg-amber/20 text-[#7a4d00]",
  alert: "bg-alert/10 text-alert",
  muted: "bg-surface-sunken text-muted",
};

export default function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

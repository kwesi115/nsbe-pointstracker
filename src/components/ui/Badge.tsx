export type BadgeTone = "ink" | "signal" | "amber" | "alert" | "muted";

const TONE: Record<BadgeTone, string> = {
  ink: "bg-inverse text-on-inverse",
  signal: "bg-signal/10 text-signal-strong",
  amber: "bg-torch/20 text-torch-strong",
  alert: "bg-alert/10 text-alert",
  muted: "bg-surface-raised text-muted",
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

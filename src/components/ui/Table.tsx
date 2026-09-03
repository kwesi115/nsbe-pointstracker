import type { ReactNode } from "react";

export const thClass = "py-2.5 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-muted";
export const tdClass = "py-3 pr-4 align-top text-sm text-ink";

export default function Table({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <table className={`w-full min-w-[640px] border-collapse text-sm ${className}`}>{children}</table>
    </div>
  );
}

export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-line px-4">{children}</tr>
    </thead>
  );
}

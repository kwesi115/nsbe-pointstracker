"use client";

import { useEffect, useState } from "react";
import { formatClock } from "@/lib/format";

/** Ticking mm:ss (or h:mm:ss) until `to`. Freezes at 0:00 once passed — callers decide what "expired" means. */
export default function Countdown({ to, className = "" }: { to: Date; className?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={`numeric ${className}`} aria-live="polite" aria-atomic="true" suppressHydrationWarning>
      {now === null ? "—:—" : formatClock(to.getTime() - now)}
    </span>
  );
}

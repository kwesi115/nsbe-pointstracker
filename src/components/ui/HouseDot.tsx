import type { House } from "@/lib/houses";

/**
 * A House's color, rendered as a small filled dot — never color alone (see
 * HouseLabel below, which always pairs it with the name). A thin border keeps
 * a dark House (e.g. Johnson's near-black) from reading as a missing swatch
 * on a white background.
 */
export default function HouseDot({ color, className = "" }: { color?: string; className?: string }) {
  if (!color) return null;
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/15 ${className}`}
      style={{ backgroundColor: color }}
    />
  );
}

/** Dot + name together — the only way a House should ever be displayed as a read value. Falls back to a plain em dash when there's no House to show. */
export function HouseLabel({
  house,
  houses,
  fallback = "—",
}: {
  house: string;
  houses: House[];
  fallback?: string;
}) {
  if (!house) return <>{fallback}</>;
  const color = houses.find((h) => h.name === house)?.color;
  return (
    <span className="inline-flex items-center gap-1.5">
      <HouseDot color={color} />
      {house}
    </span>
  );
}

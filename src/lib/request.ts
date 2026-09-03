/** Shared client-IP resolution for Server Actions (which only have next/headers, not a Request) — same header preference order as auth.ts's clientIp(request). */
import { headers } from "next/headers";

export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  return h.get("x-real-ip")?.trim() || "unknown";
}

/** Same resolution, for a Route Handler that has an actual Request (see auth.ts's own private clientIp — same order, kept here too so Route Handlers outside auth.ts don't need to duplicate it a third time). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first;
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

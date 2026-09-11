"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Badge from "@/components/ui/Badge";
import EmptyState from "@/components/ui/EmptyState";
import { inputClass, selectClass } from "@/components/ui/Field";
import { formatDate } from "@/lib/format";
import type { EventAttendanceSummary } from "@/lib/repo";

export interface DirectoryFilters {
  season: string;
  category: string;
  from: string;
  to: string;
  q: string;
}

/**
 * Master-detail: the event list on the left, the selected event's attendance
 * on the right (stacked on a phone).
 *
 * Chosen over a tab strip or an accordion because the season keeps growing.
 * By April a chapter has 30+ events, and:
 *   - a horizontal tab strip overflows and becomes a scroll-hunt
 *   - an accordion is one long column where the event you opened is pushed
 *     off-screen by the attendance underneath it, and every expanded panel
 *     competes for the same vertical space
 *
 * The list here is one bounded, independently scrolling column that stays put
 * while you read the detail beside it, and the selection lives in the URL
 * (?event=…), so it survives a refresh, can be linked to a colleague, and
 * lets the SERVER render only the selected event's attendance — the detail
 * pane never holds 30 events' worth of registrations.
 */
export default function AttendanceDirectory({
  events,
  seasons,
  categories,
  filters,
  selectedId,
  children,
}: {
  events: EventAttendanceSummary[];
  seasons: string[];
  categories: Array<{ id: string; name: string }>;
  filters: DirectoryFilters;
  selectedId: string | null;
  /** The server-rendered detail pane for the selected event. */
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === "all") params.delete(key);
    else params.set(key, value);
    // Changing a filter can hide the selected event — drop the selection so
    // the detail pane never shows an event the list no longer contains.
    params.delete("event");
    router.push(`${pathname}?${params.toString()}`);
  }

  function hrefFor(eventId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("event", eventId);
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-xs font-medium text-muted">
          Search events
          <input
            type="search"
            defaultValue={filters.q}
            onChange={(e) => updateParam("q", e.target.value)}
            placeholder="Event name"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Season
          <select defaultValue={filters.season} onChange={(e) => updateParam("season", e.target.value)} className={`${selectClass} w-36`}>
            <option value="all">All seasons</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Category
          <select defaultValue={filters.category} onChange={(e) => updateParam("category", e.target.value)} className={`${selectClass} w-44`}>
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          From
          <input type="date" defaultValue={filters.from} onChange={(e) => updateParam("from", e.target.value)} className={`${inputClass} w-40`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          To
          <input type="date" defaultValue={filters.to} onChange={(e) => updateParam("to", e.target.value)} className={`${inputClass} w-40`} />
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* The list: bounded and independently scrolling, so it stays usable
            at 30+ events instead of pushing the detail off the page. */}
        <nav aria-label="Events" className="flex max-h-[70vh] flex-col overflow-y-auto rounded-xl border border-line">
          {events.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted">No events match these filters.</p>
          ) : (
            <ul className="flex flex-col">
              {events.map((e) => (
                <li key={e.eventId} className="border-b border-line last:border-0">
                  <Link
                    href={hrefFor(e.eventId)}
                    aria-current={e.eventId === selectedId ? "true" : undefined}
                    className={`flex flex-col gap-1 px-4 py-3 text-sm hover:bg-surface-sunken ${
                      e.eventId === selectedId ? "bg-signal/10" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{e.name}</span>
                      {e.audience === "eboard_only" ? <Badge tone="amber">E-Board</Badge> : null}
                    </span>
                    <span className="text-xs text-muted">
                      {e.date ? formatDate(e.date) : "No date"} · {e.categoryShortName || e.categoryName}
                    </span>
                    <span className="numeric text-xs text-muted">
                      {e.attendeeCount} attended · {e.totalPoints} pts
                      {e.manualCount > 0 ? ` · ${e.manualCount} by hand` : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </nav>

        <div className="min-w-0">
          {selectedId ? (
            children
          ) : (
            <EmptyState title="Pick an event" description="Choose an event on the left to see and edit who attended." />
          )}
        </div>
      </div>
    </div>
  );
}

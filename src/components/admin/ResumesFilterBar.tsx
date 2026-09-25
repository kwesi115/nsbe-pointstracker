"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inputClass, selectClass } from "@/components/ui/Field";
import type { House } from "@/lib/houses";

const CLASSIFICATION_OPTIONS = [
  { value: "freshman", label: "Freshman" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
  { value: "graduate", label: "Graduate" },
] as const;

const FILTER_KEYS = ["classification", "major", "house", "eligible"] as const;

const DEBOUNCE_MS = 300;

/**
 * Scoping bar for /admin/resumes.
 *
 * Four filters, all inline — no "Filters" popover like the roster's, because
 * there are four of them and every one of them is the reason someone is on
 * this page ("the sophomore mechanical engineers, for Lockheed"). Hiding them
 * behind a button would add a click to the only thing this page does.
 *
 * State lives in the URL, same as MembersFilterBar: the Server Component
 * re-queries per navigation, and — the part that matters here — "Download all"
 * submits these same values, so what the admin sees and what lands in the zip
 * (and in the AdminLog) are the one description.
 */
export default function ResumesFilterBar({ majors, houses }: { majors: string[]; houses: House[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A chip-clear or a back/forward navigation changes the URL without going
  // through onSearchChange — adopt the new value rather than leaving a stale
  // string in the box.
  const [seenQ, setSeenQ] = useState(searchParams.get("q") ?? "");
  const urlQ = searchParams.get("q") ?? "";
  if (urlQ !== seenQ) {
    setSeenQ(urlQ);
    setQ(urlQ);
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "" || value === "all") params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  function onSearchChange(value: string) {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => updateParam("q", value), DEBOUNCE_MS);
  }

  function labelFor(key: string, value: string): string {
    if (key === "q") return `“${value}”`;
    if (key === "classification") return CLASSIFICATION_OPTIONS.find((o) => o.value === value)?.label ?? value;
    if (key === "house") return value === "none" ? "No House on file" : `House: ${value}`;
    if (key === "eligible") return value === "yes" ? "Eligible" : "Ineligible";
    return value;
  }

  const chips = [
    ...(urlQ ? [{ key: "q", value: urlQ }] : []),
    ...FILTER_KEYS.filter((k) => searchParams.get(k)).map((k) => ({ key: k as string, value: searchParams.get(k)! })),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs font-medium text-muted">
          Search
          <input
            type="search"
            value={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Name, email, or major"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Classification
          <select
            value={searchParams.get("classification") ?? "all"}
            onChange={(e) => updateParam("classification", e.target.value)}
            className={`${selectClass} w-40`}
          >
            <option value="all">All classes</option>
            {CLASSIFICATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Major
          <select
            value={searchParams.get("major") ?? "all"}
            onChange={(e) => updateParam("major", e.target.value)}
            className={`${selectClass} w-48`}
          >
            <option value="all">All majors</option>
            {majors.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          House
          <select
            value={searchParams.get("house") ?? "all"}
            onChange={(e) => updateParam("house", e.target.value)}
            className={`${selectClass} w-40`}
          >
            <option value="all">All Houses</option>
            {houses.map((h) => (
              <option key={h.code} value={h.name}>
                {h.name}
              </option>
            ))}
            {/* A member with a resume but no House would be missed by every
                House-scoped bundle — findable on purpose. */}
            <option value="none">No House on file</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Eligibility
          <select
            value={searchParams.get("eligible") ?? "all"}
            onChange={(e) => updateParam("eligible", e.target.value)}
            className={`${selectClass} w-36`}
          >
            <option value="all">Any</option>
            <option value="yes">Eligible</option>
            <option value="no">Ineligible</option>
          </select>
        </label>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => {
                if (chip.key === "q") setQ("");
                updateParam(chip.key, "all");
              }}
              className="inline-flex items-center gap-1 rounded-full bg-surface-raised px-2.5 py-1 text-xs font-medium text-foreground hover:bg-border"
            >
              {labelFor(chip.key, chip.value)}
              <X size={12} aria-hidden="true" />
              <span className="sr-only">Remove filter</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { inputClass, selectClass } from "@/components/ui/Field";
import { SHIRT_SIZE_OPTIONS } from "@/lib/core-form";

const TRI_FILTERS = [
  { key: "eligible", label: "Eligible", yes: "Eligible", no: "Ineligible" },
  { key: "dues", label: "Dues", yes: "Reported", no: "Not reported" },
  { key: "national", label: "National", yes: "Reported", no: "Not reported" },
  { key: "resume", label: "Resume", yes: "On file", no: "None" },
] as const;

/**
 * House is its own filter rather than one of the tri-states above: "no
 * House on file at all" is a distinct, actionable state (the account was
 * never asked, or skipped the step) and needs to be findable on its own.
 * Folded into "Not verified" it was indistinguishable from a House waiting
 * on review. See admin/members/page.tsx asHouseFilter.
 */
const HOUSE_OPTIONS = [
  { value: "verified", label: "Verified" },
  { value: "pending", label: "Awaiting review" },
  { value: "missing", label: "Missing — no House on file" },
] as const;

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
] as const;

const CLASSIFICATION_OPTIONS = [
  { value: "freshman", label: "Freshman" },
  { value: "sophomore", label: "Sophomore" },
  { value: "junior", label: "Junior" },
  { value: "senior", label: "Senior" },
  { value: "graduate", label: "Graduate" },
] as const;

// Every filter key EXCEPT search and role — those two stay inline, everything
// else here lives in the "Filters" popover and counts toward its badge.
const POPOVER_KEYS = ["status", ...TRI_FILTERS.map((f) => f.key), "house", "major", "classification", "tshirt"] as const;

const DEBOUNCE_MS = 300;

function labelFor(key: string, value: string): string {
  if (key === "status") return STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value;
  if (key === "classification") return CLASSIFICATION_OPTIONS.find((o) => o.value === value)?.label ?? value;
  if (key === "role") return value === "eboard" ? "E-Board" : value.charAt(0).toUpperCase() + value.slice(1);
  if (key === "house") return `House: ${HOUSE_OPTIONS.find((o) => o.value === value)?.label ?? value}`;
  if (key === "tshirt") return value === "none" ? "T-shirt: not set" : `T-shirt: ${value}`;
  const tri = TRI_FILTERS.find((f) => f.key === key);
  if (tri) return value === "yes" ? tri.yes : tri.no;
  return value;
}

/** Search/filter state lives in the URL — the Server Component page re-filters the already-fetched roster per navigation (see admin/members/page.tsx). The search input debounces its own router.push so the URL doesn't update on every keystroke. */
export default function MembersFilterBar({ majors }: { majors: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(searchParams.get("q") ?? "");
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

  const activeCount = POPOVER_KEYS.filter((k) => searchParams.get(k) && searchParams.get(k) !== "all").length;

  const chips = [
    ...(searchParams.get("role") ? [{ key: "role", value: searchParams.get("role")! }] : []),
    ...POPOVER_KEYS.filter((k) => searchParams.get(k) && searchParams.get(k) !== "all").map((k) => ({ key: k, value: searchParams.get(k)! })),
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
            placeholder="Name, email, student ID, or NSBE ID"
            className={inputClass}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Role
          <select defaultValue={searchParams.get("role") ?? "all"} onChange={(e) => updateParam("role", e.target.value)} className={`${selectClass} w-32`}>
            <option value="all">All roles</option>
            <option value="general">General</option>
            <option value="eboard">E-Board</option>
            <option value="guest">Guest</option>
          </select>
        </label>

        <div className="relative" ref={popoverRef}>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="relative flex min-h-11 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-sm font-semibold text-ink hover:bg-surface-sunken"
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            Filters
            {activeCount > 0 ? (
              <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1 text-xs font-bold text-white">
                {activeCount}
              </span>
            ) : null}
          </button>

          {open ? (
            <>
              {/* Below sm:, this is a bottom sheet (full width, pinned to the
                  viewport) rather than a 320px-wide popover that would
                  otherwise run off the edge of a 320px phone screen. */}
              <button
                type="button"
                aria-label="Close filters"
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[var(--z-drawer-backdrop)] bg-ink/50 sm:hidden"
              />
              <div className="pb-safe-bottom fixed inset-x-0 bottom-0 z-[var(--z-drawer)] max-h-[85dvh] overflow-y-auto rounded-t-2xl border border-line bg-white p-4 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:bottom-auto sm:z-20 sm:mt-2 sm:max-h-none sm:w-80 sm:rounded-xl">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Status
                  <select
                    defaultValue={searchParams.get("status") ?? "all"}
                    onChange={(e) => updateParam("status", e.target.value)}
                    className={selectClass}
                  >
                    <option value="all">All statuses</option>
                    {STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                  Classification
                  <select
                    defaultValue={searchParams.get("classification") ?? "all"}
                    onChange={(e) => updateParam("classification", e.target.value)}
                    className={selectClass}
                  >
                    <option value="all">All classes</option>
                    {CLASSIFICATION_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
                  Major
                  <select defaultValue={searchParams.get("major") ?? "all"} onChange={(e) => updateParam("major", e.target.value)} className={selectClass}>
                    <option value="all">All majors</option>
                    {majors.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
                  House
                  <select defaultValue={searchParams.get("house") ?? "all"} onChange={(e) => updateParam("house", e.target.value)} className={selectClass}>
                    <option value="all">All</option>
                    {HOUSE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="col-span-2 flex flex-col gap-1 text-xs font-medium text-muted">
                  T-shirt size
                  <select defaultValue={searchParams.get("tshirt") ?? "all"} onChange={(e) => updateParam("tshirt", e.target.value)} className={selectClass}>
                    <option value="all">All sizes</option>
                    {SHIRT_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                    {/* The actionable gap: whoever is ordering shirts needs to find who still hasn't given one. */}
                    <option value="none">Not set</option>
                  </select>
                </label>

                {TRI_FILTERS.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1 text-xs font-medium text-muted">
                    {f.label}
                    <select defaultValue={searchParams.get(f.key) ?? "all"} onChange={(e) => updateParam(f.key, e.target.value)} className={selectClass}>
                      <option value="all">All</option>
                      <option value="yes">{f.yes}</option>
                      <option value="no">{f.no}</option>
                    </select>
                  </label>
                ))}
              </div>

              {activeCount > 0 ? (
                <button
                  type="button"
                  onClick={() => POPOVER_KEYS.forEach((k) => updateParam(k, "all"))}
                  className="mt-3 text-xs font-semibold text-signal underline underline-offset-2"
                >
                  Clear all filters
                </button>
              ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => updateParam(chip.key, "all")}
              className="inline-flex items-center gap-1 rounded-full bg-surface-sunken px-2.5 py-1 text-xs font-medium text-ink hover:bg-line"
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

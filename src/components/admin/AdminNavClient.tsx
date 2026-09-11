"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AdminNavLink } from "@/lib/access";

/**
 * The interactive half of AdminNav — the drawer state and nothing else. It
 * renders exactly the links handed to it and makes no access decision of its
 * own; AdminNav.tsx (a Server Component) has already filtered them against
 * lib/access.ts. Nothing about a link the caller can't use should reach the
 * browser, so the filtering deliberately does not live here.
 *
 * Up to eleven items is too many for any bar at phone width — below md: this
 * is a hamburger button that opens a full-height drawer instead of trying to
 * shrink/wrap the same row (see the mobile-nav spec: "collapse to a hamburger
 * drawer below 768px, do not attempt to fit it in a bar"). No
 * verification-count badge — the membership audit queue is a spot-check, not a
 * blocking gate (see /admin/verifications), and a permanent red badge trains
 * people to ignore it.
 */
export default function AdminNavClient({ links, active }: { links: AdminNavLink[]; active: string }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const activeLabel = links.find((l) => l.href === active)?.label ?? "Admin";

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Nothing to render for someone with no admin surfaces at all — but a single
  // surface still gets its item, so the one thing they DO have access to is
  // visible rather than silently absent.
  if (links.length === 0) return null;

  return (
    <>
      {/* Mobile: hamburger + current section name, opens the drawer below. */}
      <div className="flex items-center gap-3 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open admin menu"
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-ink"
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <span className="text-sm font-semibold text-ink">{activeLabel}</span>
      </div>

      {/* Desktop: the original flex-wrap link row, unchanged. */}
      <nav aria-label="Admin" className="hidden flex-wrap gap-x-4 gap-y-1 md:flex">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-1.5 text-sm underline-offset-2 hover:text-ink ${
              link.href === active ? "font-semibold text-ink underline" : "text-muted underline"
            }`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      {open ? (
        <div className="fixed inset-0 z-[var(--z-drawer-backdrop)] md:hidden">
          <button
            type="button"
            aria-label="Close admin menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/50"
          />
          <div
            ref={drawerRef}
            role="menu"
            aria-label="Admin sections"
            className="pb-safe-bottom pt-safe-top absolute inset-y-0 left-0 z-[var(--z-drawer)] flex w-[85vw] max-w-xs flex-col overflow-y-auto bg-surface shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <span className="font-display text-sm font-bold text-ink">Admin</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close admin menu"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-sunken"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <nav className="flex flex-col gap-1 p-2">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium ${
                    link.href === active ? "bg-signal/10 text-signal" : "text-ink hover:bg-surface-sunken"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}

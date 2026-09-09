"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "/admin", label: "Events" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/verifications", label: "Membership audit" },
  { href: "/admin/leaderboard", label: "E-Board leaderboard" },
  { href: "/admin/attendance", label: "Attendance" },
  { href: "/admin/groups", label: "NSBE Week groups" },
  { href: "/admin/awards", label: "Bonus awards" },
  { href: "/admin/exports", label: "Exports" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/qr", label: "QR code" },
  { href: "/admin/join-codes", label: "Join codes" },
] as const;

/**
 * Cross-nav for every /admin/* page. Eleven items is too many for any bar at
 * phone width — below md: this is a hamburger button that opens a full-height
 * drawer instead of trying to shrink/wrap the same row (see the mobile-nav
 * spec: "collapse to a hamburger drawer below 768px, do not attempt to fit
 * it in a bar"). No verification-count badge — the membership audit queue is
 * a spot-check, not a blocking gate (see /admin/verifications), and a
 * permanent red badge trains people to ignore it.
 */
export default function AdminNav({ active }: { active: (typeof LINKS)[number]["href"] }) {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const activeLabel = LINKS.find((l) => l.href === active)?.label ?? "Admin";

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

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
        {LINKS.map((link) => (
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
                className="flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-surface-sunken hover:text-ink"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>
            <nav className="flex flex-col gap-1 p-2">
              {LINKS.map((link) => (
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

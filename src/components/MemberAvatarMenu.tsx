"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { signOutAction } from "@/app/(member)/actions";

/**
 * Mobile-only (hidden at md: and up — see MemberNav) home for everything
 * that doesn't fit a compact top bar: who's signed in, the Admin/
 * Verifications link (if any), and sign-out. Same click-outside/Escape
 * pattern as MembersFilterBar's popover.
 */
export default function MemberAvatarMenu({
  firstName,
  email,
  adminHref,
  adminLabel,
}: {
  firstName: string;
  email: string;
  adminHref: string | null;
  adminLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  const initial = (firstName || email)[0]?.toUpperCase() ?? "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-sm font-semibold text-white"
      >
        {initial}
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-[var(--z-dropdown)] mt-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-lg"
        >
          <p className="truncate px-3 py-2 text-sm text-muted">{firstName ? `Hi, ${firstName}` : email}</p>
          {adminHref ? (
            <Link
              href={adminHref}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-surface-sunken"
            >
              {adminLabel}
            </Link>
          ) : null}
          <form action={signOutAction}>
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-medium text-ink hover:bg-surface-sunken"
            >
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

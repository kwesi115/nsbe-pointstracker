"use client";

import { Calendar, LayoutDashboard, Trophy, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const TABS = [
  { href: "/events", label: "Events", icon: Calendar },
  { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/account", label: "Account", icon: User },
] as const;

const TEXT_ENTRY_TYPES = new Set(["text", "email", "tel", "search", "password", "number", "url", "date"]);

function isTextEntryElement(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_ENTRY_TYPES.has(el.type);
  return false;
}

/**
 * True whenever a fixed bottom bar competing with a focused input's own
 * submit button for space is worse than no bottom bar at all — the check-in
 * code gate, an /account form. Either signal is enough on its own:
 *
 *  1. A text-entry element has focus. Direct and unambiguous, and covers the
 *     case a synthetic/emulated viewport resize doesn't: a genuinely short
 *     viewport (a small device, a rotated phone) where the keyboard and the
 *     rest of the page are already the same visualViewport/innerHeight ratio
 *     — nothing "shrinks" relative to anything, so signal 2 alone would miss
 *     it, but the input still needs the room a bottom bar would take.
 *  2. The on-screen keyboard has visibly shrunk the visual viewport relative
 *     to the (unchanged) layout viewport — the real-device keyboard case,
 *     and the only one of the two with no focus event to key off (some IME
 *     toggles open a keyboard without moving focus).
 *
 * This component only renders below md:, where a tablet/desktop keyboard
 * being "always focused" isn't a real concern — a focus on a touch phone
 * reliably means a suddenly-scarce screen, on-screen keyboard or not.
 */
function useShouldHideForKeyboard(): boolean {
  const [focused, setFocused] = useState(false);
  const [viewportShrunk, setViewportShrunk] = useState(false);

  useEffect(() => {
    function onFocusIn(e: FocusEvent) {
      setFocused(isTextEntryElement(e.target as Element));
    }
    function onFocusOut() {
      setFocused(false);
    }
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onResize() {
      setViewportShrunk(vv!.height < window.innerHeight * 0.75);
    }
    vv.addEventListener("resize", onResize);
    onResize();
    return () => vv.removeEventListener("resize", onResize);
  }, []);

  return focused || viewportShrunk;
}

/**
 * Mobile-only primary nav (hidden at md: and up, where MemberNav's inline
 * header nav takes over). Fixed to the viewport bottom, sized to
 * --bottom-nav-height + the safe-area inset so its own padding and every
 * scrollable page's .pb-bottom-nav (globals.css) agree on exactly one
 * number. Admin/Verifications access lives in the avatar menu instead of a
 * 5th tab — see MemberAvatarMenu.
 */
export default function MemberBottomNav() {
  const pathname = usePathname();
  const hideForKeyboard = useShouldHideForKeyboard();

  if (hideForKeyboard) return null;

  return (
    <nav
      aria-label="Primary"
      className="pb-safe-bottom fixed inset-x-0 bottom-0 z-[var(--z-bottom-nav)] flex h-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px))] border-t border-line bg-surface md:hidden print:hidden"
    >
      {TABS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors ${
              active ? "text-signal" : "text-muted"
            }`}
          >
            <Icon size={22} aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

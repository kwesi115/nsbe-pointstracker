"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { currentTheme, setTheme, subscribeToTheme, type Theme } from "@/lib/theme";

// The server can't know the theme. The knob position and icon below are driven
// by the `dark:` variant instead of this value, so they are already right at
// first paint; only aria-checked waits for hydration.
const serverTheme = (): Theme => "light";

/**
 * The light/dark switch — in MemberNav (which every member and admin page
 * renders), the public layout (/, /signin, /join) and the guest layout.
 * A real <button role="switch">: Tab to reach, Space/Enter to flip.
 */
export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeToTheme, currentTheme, serverTheme);
  const dark = theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full"
    >
      <span
        aria-hidden="true"
        className="relative flex h-7 w-12 items-center rounded-full border border-border bg-surface-raised"
      >
        <span className="absolute left-0.5 flex h-5.5 w-5.5 items-center justify-center rounded-full bg-surface text-torch-strong shadow-sm transition-transform dark:translate-x-5 dark:text-signal-strong">
          <Sun size={14} className="dark:hidden" />
          <Moon size={14} className="hidden dark:block" />
        </span>
      </span>
    </button>
  );
}

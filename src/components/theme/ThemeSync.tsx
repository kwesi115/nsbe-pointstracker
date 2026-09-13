"use client";

import { useLayoutEffect } from "react";
import { applyTheme, storedTheme, systemTheme, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Keeps <html>'s `dark` class right after THEME_INIT_SCRIPT has set it for
 * first paint. Mounted once, in the root layout, so it covers every route —
 * including the ones with no toggle on them.
 *
 *  - Re-applies on mount. In development React's Strict Mode remount resets
 *    <html> to its JSX attributes, dropping the class the script added; this
 *    is a no-op in production.
 *  - Follows the OS setting live while there is no stored choice.
 *  - Follows a choice made in another tab.
 */
export default function ThemeSync() {
  useLayoutEffect(() => {
    const resolve = () => applyTheme(storedTheme() ?? systemTheme());
    resolve();

    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onSystemChange = () => {
      if (!storedTheme()) resolve();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) resolve();
    };

    media?.addEventListener("change", onSystemChange);
    window.addEventListener("storage", onStorage);
    return () => {
      media?.removeEventListener("change", onSystemChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return null;
}

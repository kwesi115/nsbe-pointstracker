/**
 * Light/dark theme — the storage key, the pre-paint script, and the DOM
 * helpers, in one place. The palette itself lives in globals.css; this file
 * only decides which half of it applies, by toggling `dark` on <html>.
 *
 * No stored choice → follow prefers-color-scheme (and keep following it live,
 * see ThemeSync). Flipping ThemeToggle stores an explicit choice, which wins
 * from then on, on every route and across reloads.
 */

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/**
 * Runs synchronously in <head> before first paint — without it every hard
 * load paints light and then flips (see node_modules/next/dist/docs/01-app/
 * 02-guides/preventing-flash-before-hydration.md). A literal string rather
 * than a stringified function so nothing a minifier does can break it;
 * theme.test.ts evaluates exactly this string.
 */
// Storage and matchMedia are guarded separately: blocked storage (private
// mode) should still follow the system preference, not fall back to light.
export const THEME_INIT_SCRIPT = `(function(){var s=null;try{s=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}try{var d=s==="dark"||(s!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function storedTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    // Storage blocked (private mode, sandboxed iframe) — behave as a first visit.
    return null;
  }
}

export function systemTheme(): Theme {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** An explicit choice: persisted, then applied. */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not persisted, but still applied for this page.
  }
  applyTheme(theme);
}

/** Notifies on any change to <html>'s class — every toggle on the page stays in sync, whoever flipped it. */
export function subscribeToTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

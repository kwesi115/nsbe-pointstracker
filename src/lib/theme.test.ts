// @vitest-environment jsdom
/**
 * The pre-paint theme script — the only thing standing between a hard refresh
 * and a white flash. Evaluates the exact string the root layout inlines.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTheme, storedTheme, THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from "./theme";

function runScript() {
  new Function(THEME_INIT_SCRIPT)();
}

function systemPrefers(dark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({ matches: dark && query === "(prefers-color-scheme: dark)" }),
  });
}

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("THEME_INIT_SCRIPT", () => {
  it("follows the system preference on a first visit", () => {
    systemPrefers(true);
    runScript();
    expect(isDark()).toBe(true);

    document.documentElement.className = "";
    systemPrefers(false);
    runScript();
    expect(isDark()).toBe(false);
  });

  it("a stored choice wins over the system preference, in both directions", () => {
    systemPrefers(true);
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    runScript();
    expect(isDark()).toBe(false);

    systemPrefers(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runScript();
    expect(isDark()).toBe(true);
  });

  it("treats a junk stored value as no choice", () => {
    systemPrefers(true);
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    runScript();
    expect(isDark()).toBe(true);
  });

  it("still follows the system when storage is blocked, and never throws", () => {
    systemPrefers(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(runScript).not.toThrow();
    expect(isDark()).toBe(true);
  });

  it("never throws without matchMedia either — the page just paints light", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    expect(runScript).not.toThrow();
    expect(isDark()).toBe(false);
  });

  it("leaves the font and layout classes already on <html> alone", () => {
    document.documentElement.className = "font-vars h-full antialiased";
    systemPrefers(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    runScript();
    expect([...document.documentElement.classList]).toEqual(["font-vars", "h-full", "antialiased", "dark"]);
  });
});

describe("setTheme / storedTheme", () => {
  it("persists the choice where the pre-paint script reads it", () => {
    setTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(isDark()).toBe(true);

    // What the next page load does with it.
    document.documentElement.className = "";
    systemPrefers(false);
    runScript();
    expect(isDark()).toBe(true);
  });

  it("reads back only a real theme", () => {
    expect(storedTheme()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(storedTheme()).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(storedTheme()).toBe("light");
  });
});

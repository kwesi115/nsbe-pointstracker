// @vitest-environment jsdom
/**
 * The theme switch, and ThemeSync keeping <html> right after first paint.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { click, flush } from "@/test/dom";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import ThemeSync from "./ThemeSync";
import ThemeToggle from "./ThemeToggle";

let systemDark = false;
let systemListeners: Array<() => void> = [];

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = "";
  systemDark = false;
  systemListeners = [];
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      get matches() {
        return systemDark && query === "(prefers-color-scheme: dark)";
      },
      addEventListener: (_type: string, listener: () => void) => systemListeners.push(listener),
      removeEventListener: (_type: string, listener: () => void) => {
        systemListeners = systemListeners.filter((l) => l !== listener);
      },
    }),
  });
});

const isDark = () => document.documentElement.classList.contains("dark");

function systemChangesTo(dark: boolean) {
  systemDark = dark;
  for (const listener of systemListeners) listener();
}

describe("ThemeToggle", () => {
  it("is a real, labelled switch button — reachable by Tab, operable by Space/Enter", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: "Dark mode" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("flips the whole document and persists the choice, both ways", async () => {
    render(<ThemeToggle />);
    const toggle = screen.getByRole("switch", { name: "Dark mode" });

    await click(toggle);
    await flush();
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(toggle.getAttribute("aria-checked")).toBe("true");

    await click(toggle);
    await flush();
    expect(isDark()).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("reports a theme that was already applied before it mounted — a reload in dark", async () => {
    document.documentElement.classList.add("dark");
    render(<ThemeToggle />);
    await flush();
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });

  it("keeps every switch on the page in step", async () => {
    render(
      <>
        <ThemeToggle />
        <ThemeToggle />
      </>,
    );
    const [first, second] = screen.getAllByRole("switch");
    await click(first);
    await flush();
    expect(second.getAttribute("aria-checked")).toBe("true");
  });
});

describe("ThemeSync", () => {
  it("follows the system setting on a first visit, including a change while the page is open", () => {
    systemDark = true;
    render(<ThemeSync />);
    expect(isDark()).toBe(true);

    systemChangesTo(false);
    expect(isDark()).toBe(false);
  });

  it("an explicit choice outranks the system setting", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    systemDark = true;
    render(<ThemeSync />);
    expect(isDark()).toBe(false);

    systemChangesTo(true);
    expect(isDark()).toBe(false);
  });

  it("restores the stored theme if the class was stripped (React's dev remount of <html>)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeSync />);
    expect(isDark()).toBe(true);
  });

  it("follows a choice made in another tab", () => {
    render(<ThemeSync />);
    expect(isDark()).toBe(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    window.dispatchEvent(new StorageEvent("storage", { key: THEME_STORAGE_KEY }));
    expect(isDark()).toBe(true);
  });
});

/**
 * The theme's contract, checked against the files themselves rather than a
 * rendered page:
 *
 *   - every themed color has a light AND a dark value, in globals.css only;
 *   - no component names a raw color (a stray bg-white stays light in dark mode);
 *   - every dark-mode text/background pair the components actually use clears
 *     WCAG AA (4.5:1);
 *   - House colors are not theme values, and Johnson stays visible in both themes;
 *   - the projector display is built only from fixed tokens, so the toggle
 *     cannot reach it.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_HOUSES } from "./houses";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const css = read("src/app/globals.css");

function tokenBlock(selector: string): Map<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  if (start === -1) throw new Error(`globals.css has no "${selector}" block`);
  const body = css.slice(start, css.indexOf("\n}", start)).replace(/\/\*[\s\S]*?\*\//g, "");
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = tokenBlock(":root");
const dark = tokenBlock(":root.dark");

/** Tokens that are deliberately the same in both themes — see the FIXED note in globals.css. */
const FIXED = ["--projector-background", "--projector-foreground", "--projector-accent", "--projector-qr", "--on-brand"];
const isColorToken = (name: string) => !name.startsWith("--z-") && name !== "--bottom-nav-height";

// ---------------------------------------------------------------------------
// Color math (WCAG 2.x relative luminance).
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number];

function parseColor(value: string): RGBA {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1].split(",").map((part) => part.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  throw new Error(`test can't parse color "${value}"`);
}

const withAlpha = ([r, g, b, a]: RGBA, alpha: number): RGBA => [r, g, b, a * alpha];
const over = (top: RGBA, bottom: RGBA): RGBA =>
  [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as RGBA;

function luminance([r, g, b]: RGBA): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A token's value in a theme — dark falls back to :root, as the cascade does. */
function color(theme: Map<string, string>, token: string): RGBA {
  const value = theme.get(token) ?? light.get(token);
  if (!value) throw new Error(`no token ${token}`);
  return parseColor(value);
}

// ---------------------------------------------------------------------------

describe("theme tokens", () => {
  it("defines every themed color for both light and dark, and nothing dark-only", () => {
    const themed = [...light.keys()].filter((name) => isColorToken(name) && !FIXED.includes(name));
    expect(themed.filter((name) => !dark.has(name))).toEqual([]);
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([]);
  });

  it("re-picks the accents for dark instead of reusing the light-mode values", () => {
    for (const accent of ["--signal", "--signal-strong", "--torch", "--alert", "--success", "--on-signal", "--on-alert"]) {
      expect(dark.get(accent), accent).not.toBe(light.get(accent));
    }
    expect(dark.get("--signal")).toBe("#5b7cf5");
  });

  it("keeps the fixed tokens out of the dark block", () => {
    for (const name of FIXED) expect(dark.has(name), name).toBe(false);
  });
});

describe("dark mode contrast (WCAG AA, 4.5:1)", () => {
  const c = (token: string) => color(dark, token);
  const tint = (fill: string, alpha: number, base: string) => over(withAlpha(c(fill), alpha), c(base));

  const GROUNDS = ["--background", "--surface", "--surface-raised", "--input"];
  const TEXT = ["--foreground", "--muted", "--signal-strong", "--alert", "--torch", "--torch-strong", "--success"];

  const pairs: Array<[string, RGBA, RGBA]> = [
    ...TEXT.flatMap((text) => GROUNDS.map((ground) => [`${text} on ${ground}`, c(text), c(ground)] as [string, RGBA, RGBA])),
    // Placeholders are text.
    ["--muted placeholder on --input", c("--muted"), c("--input")],
    ["--placeholder-faint on --input", c("--placeholder-faint"), c("--input")],
    ["--placeholder-soft on --input", c("--placeholder-soft"), c("--input")],
    // Tinted fills: Badge, admin drawer active item, leaderboard "you" row, ErrorState, callouts, banners.
    ["--signal-strong on signal/10 over --surface", c("--signal-strong"), tint("--signal", 0.1, "--surface")],
    ["--signal-strong on signal/10 over --surface-raised", c("--signal-strong"), tint("--signal", 0.1, "--surface-raised")],
    ["--foreground on signal/5 over --surface", c("--foreground"), tint("--signal", 0.05, "--surface")],
    ["--muted on signal/5 over --surface", c("--muted"), tint("--signal", 0.05, "--surface")],
    ["--alert on alert/10 over --surface", c("--alert"), tint("--alert", 0.1, "--surface")],
    ["--foreground on alert/5 over --surface", c("--foreground"), tint("--alert", 0.05, "--surface")],
    ["--muted on alert/5 over --surface", c("--muted"), tint("--alert", 0.05, "--surface")],
    ["--torch-strong on torch/20 over --surface", c("--torch-strong"), tint("--torch", 0.2, "--surface")],
    ["--foreground on torch/10 over --surface", c("--foreground"), tint("--torch", 0.1, "--surface")],
    ["--muted on torch/10 over --surface", c("--muted"), tint("--torch", 0.1, "--surface")],
    ["--foreground on --torch-subtle over --background", c("--foreground"), over(c("--torch-subtle"), c("--background"))],
    ["--muted on --torch-subtle over --background", c("--muted"), over(c("--torch-subtle"), c("--background"))],
    // Filled controls and chips.
    ["--on-signal on --signal", c("--on-signal"), c("--signal")],
    ["--on-signal on --signal-hover", c("--on-signal"), c("--signal-hover")],
    ["--on-signal on --signal-active", c("--on-signal"), c("--signal-active")],
    ["--on-alert on --alert", c("--on-alert"), c("--alert")],
    ["--on-alert on --alert-hover", c("--on-alert"), c("--alert-hover")],
    ["--on-inverse on --inverse", c("--on-inverse"), c("--inverse")],
    // The image lightbox: title, and its /70 subtitle.
    ["--on-scrim on scrim/95", c("--on-scrim"), tint("--scrim", 0.95, "--surface")],
    [
      "--on-scrim/70 on scrim/95",
      over(withAlpha(c("--on-scrim"), 0.7), tint("--scrim", 0.95, "--surface")),
      tint("--scrim", 0.95, "--surface"),
    ],
  ];

  it.each(pairs)("%s", (_label, text, ground) => {
    expect(contrast(text, ground)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("House colors", () => {
  it("are chapter identity, not theme values — no theme token carries one, in either theme", () => {
    const tokenValues = [...light.values(), ...dark.values()].map((value) => value.toLowerCase());
    for (const house of DEFAULT_HOUSES) expect(tokenValues, house.name).not.toContain(house.color.toLowerCase());
  });

  it("Johnson's near-black stays visible against every ground in both themes (3:1, dot or its ring)", () => {
    const johnson = parseColor(DEFAULT_HOUSES.find((h) => h.name === "Johnson")!.color);
    for (const [themeName, theme] of [["light", light], ["dark", dark]] as const) {
      for (const ground of ["--background", "--surface", "--surface-raised"]) {
        const g = color(theme, ground);
        const ring = over(color(theme, "--swatch-border"), g);
        const visible = Math.max(contrast(johnson, g), contrast(ring, g));
        expect(visible, `${themeName} ${ground}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("the projector display", () => {
  const source = read("src/components/admin/ProjectorClient.tsx") + read("src/app/admin/events/[id]/display/page.tsx");

  it("uses no themed color utility or variable, so the toggle cannot change it", () => {
    const themed = [...dark.keys()].map((name) => name.slice(2)).sort((a, b) => b.length - a.length);
    const utility = new RegExp(`(?<![\\w-])(?:bg|text|border|stroke|fill|ring|outline|divide)-(?:${themed.join("|")})(?![\\w-])`, "g");
    expect(source.match(utility)).toBeNull();
    expect(source).not.toMatch(/var\(--(?!projector-)/);
    expect(source).not.toContain("ThemeToggle");
  });

  it("is actually drawn with the fixed projector tokens", () => {
    expect(source).toContain("bg-projector ");
    expect(source).toContain("text-projector-foreground");
    expect(source).toContain("text-projector-accent");
  });
});

describe("no raw colors in components", () => {
  /** Literal colors that are data, not theme — each for a stated reason. */
  const ALLOWED_LITERALS = new Set([
    "src/lib/houses.ts", // House colors: chapter identity, fixed across themes
    "src/lib/qr.ts", // QR codes must stay dark-on-light to scan
    "src/app/(member)/admin/settings/actions.ts", // default color for a newly added House
    "src/components/admin/CoreFormSettingsForm.tsx", // the same default, client side
  ]);

  const PALETTE =
    /(?<![\w-])(?:bg|text|border|ring|fill|stroke|divide|outline|from|to|via|decoration|shadow|accent|caret)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?![\w-])/;
  const ARBITRARY = /-\[(?:#|rgba?\(|hsla?\(|oklch\()/;
  const LITERAL = /(?<![&\w])#[0-9a-f]{6}\b|(?<![&\w])#[0-9a-f]{3}\b|rgba?\(|oklch\(/i;

  function sourceFiles(dir: string): string[] {
    return readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return sourceFiles(rel);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
    });
  }

  it("uses tokens everywhere — no Tailwind palette classes, arbitrary colors, or color literals", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles("src")) {
      read(file)
        .split("\n")
        .forEach((line, i) => {
          const literal = !ALLOWED_LITERALS.has(file) && LITERAL.test(line);
          if (PALETTE.test(line) || ARBITRARY.test(line) || literal) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

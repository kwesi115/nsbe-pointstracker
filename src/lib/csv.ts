/**
 * Minimal RFC4180-ish CSV parse/write. No external dependency — the shapes we
 * move (member import rows, response exports, setup-code exports) are simple
 * enough that a hand-rolled parser is easier to reason about than a new dep.
 */

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a leading UTF-8 BOM — toCsv() below writes one so Excel opens
  // non-ASCII names correctly, and that same file may come back in as an
  // upload (member import).
  const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const text = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function quoteField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Leading BOM so Excel opens the file as UTF-8 instead of guessing Latin-1 on any accented/non-ASCII name. */
export function toCsv(rows: string[][]): string {
  return "﻿" + rows.map((r) => r.map(quoteField).join(",")).join("\r\n");
}

/** Maps header names case/whitespace-insensitively to column indexes. */
export function csvHeaderIndex(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  headerRow.forEach((h, i) => map.set(h.trim().toLowerCase(), i));
  return map;
}

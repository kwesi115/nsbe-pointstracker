/**
 * Shared exceljs report styling — frozen header row, bold navy header, column
 * widths sized to content. Used by every sheet in lib/export/workbook.ts so
 * the workbook reads like a report, not a data dump.
 */

import ExcelJS from "exceljs";

const HEADER_FILL = "FF1B2A4A"; // navy
const HEADER_TEXT = "FFFFFFFF";

export function addReportSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: Array<Array<string | number | null>>,
  options?: { note?: string },
): ExcelJS.Worksheet {
  // Excel sheet names: max 31 chars, no [ ] : * ? / \
  const safeName = name.replace(/[[\]:*?/\\]/g, "-").slice(0, 31);
  // A note (e.g. the leaderboard disclaimer) pushes the header down to row 2
  // and gets its own merged, italic row 1 — everything else about the sheet
  // (freeze pane, header styling, column widths) targets that shifted row.
  const headerRowIndex = options?.note ? 2 : 1;
  const ws = workbook.addWorksheet(safeName, { views: [{ state: "frozen", ySplit: headerRowIndex }] });

  ws.columns = headers.map((h) => ({ key: h }));
  if (options?.note) {
    const noteRow = ws.addRow([options.note]);
    ws.mergeCells(1, 1, 1, headers.length);
    noteRow.font = { italic: true, color: { argb: "FF5A6485" } };
    noteRow.height = 18;
  }
  ws.addRow(headers);
  for (const row of rows) ws.addRow(row);

  const headerRow = ws.getRow(headerRowIndex);
  headerRow.height = 20;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle" };
  });

  ws.columns.forEach((col, i) => {
    let max = headers[i].length;
    for (const row of rows) {
      const v = row[i];
      if (v !== null && v !== undefined) max = Math.max(max, String(v).length);
    }
    col.width = Math.min(48, Math.max(12, max + 2));
  });

  return ws;
}

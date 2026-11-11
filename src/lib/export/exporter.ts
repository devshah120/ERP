import ExcelJS from "exceljs";

export type ExportFormat = "csv" | "xlsx";

export interface ExportColumn {
  key: string;
  label: string;
  type?: string;
}

export interface ExportPayload {
  /** Sheet/file title, e.g. "Sales Register". */
  title: string;
  columns: ExportColumn[];
  rows: Record<string, unknown>[];
  /** Optional footer totals keyed by column. */
  totals?: Record<string, string>;
  /** Headline figures written above the table (xlsx) or as comment rows (csv). */
  summary?: { label: string; value: string }[];
  /** Human-readable description of the filters that produced this data. */
  filterNote?: string;
}

const NUMERIC_TYPES = new Set(["money", "number"]);

function cellValue(row: Record<string, unknown>, col: ExportColumn): string | number | Date | null {
  const raw = row[col.key];
  if (raw === null || raw === undefined || raw === "") return null;

  // Keep numbers and dates as real types so Excel can sort, sum and format
  // them — exporting everything as text is the classic spreadsheet bug.
  if (NUMERIC_TYPES.has(col.type ?? "")) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : String(raw);
  }
  if (col.type === "date" || col.type === "datetime") {
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? String(raw) : d;
  }
  return String(raw);
}

/** RFC 4180 quoting: wrap in quotes and double any embedded quote. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(payload: ExportPayload): string {
  const lines: string[] = [];

  lines.push(csvCell(payload.title));
  if (payload.filterNote) lines.push(csvCell(payload.filterNote));
  for (const s of payload.summary ?? []) lines.push(`${csvCell(s.label)},${csvCell(s.value)}`);
  if (lines.length > 0) lines.push("");

  lines.push(payload.columns.map((c) => csvCell(c.label)).join(","));

  for (const row of payload.rows) {
    lines.push(payload.columns.map((c) => csvCell(cellValue(row, c))).join(","));
  }

  if (payload.totals && Object.keys(payload.totals).length > 0) {
    lines.push(
      payload.columns
        .map((c, i) => (i === 0 ? csvCell("Total") : csvCell(payload.totals?.[c.key] ?? "")))
        .join(",")
    );
  }

  // BOM so Excel opens UTF-8 (₹, accented names) correctly on Windows.
  return "﻿" + lines.join("\r\n");
}

export async function toXlsx(payload: ExportPayload): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  // Excel sheet names cannot exceed 31 chars or contain : \ / ? * [ ]
  const sheetName = payload.title.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Report";
  const ws = wb.addWorksheet(sheetName);

  let cursor = 1;

  ws.getCell(cursor, 1).value = payload.title;
  ws.getCell(cursor, 1).font = { bold: true, size: 14 };
  cursor += 1;

  if (payload.filterNote) {
    ws.getCell(cursor, 1).value = payload.filterNote;
    ws.getCell(cursor, 1).font = { italic: true, size: 10, color: { argb: "FF666666" } };
    cursor += 1;
  }

  for (const s of payload.summary ?? []) {
    ws.getCell(cursor, 1).value = s.label;
    ws.getCell(cursor, 1).font = { bold: true, size: 10 };
    ws.getCell(cursor, 2).value = s.value;
    cursor += 1;
  }

  cursor += 1; // blank spacer row
  const headerRowIndex = cursor;

  payload.columns.forEach((col, i) => {
    const cell = ws.getCell(headerRowIndex, i + 1);
    cell.value = col.label;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B4A6B" } };
    cell.alignment = { vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } };
  });
  cursor += 1;

  for (const row of payload.rows) {
    payload.columns.forEach((col, i) => {
      const cell = ws.getCell(cursor, i + 1);
      cell.value = cellValue(row, col);
      if (col.type === "money") cell.numFmt = "#,##0.00";
      else if (col.type === "number") cell.numFmt = "#,##0.####";
      else if (col.type === "date") cell.numFmt = "dd/mm/yyyy";
      else if (col.type === "datetime") cell.numFmt = "dd/mm/yyyy hh:mm";
      if (NUMERIC_TYPES.has(col.type ?? "")) cell.alignment = { horizontal: "right" };
    });
    cursor += 1;
  }

  if (payload.totals && Object.keys(payload.totals).length > 0) {
    payload.columns.forEach((col, i) => {
      const cell = ws.getCell(cursor, i + 1);
      if (i === 0) {
        cell.value = "Total";
      } else if (payload.totals?.[col.key] !== undefined) {
        const n = Number(payload.totals[col.key]);
        cell.value = Number.isFinite(n) ? n : payload.totals[col.key];
        if (col.type === "money") cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right" };
      }
      cell.font = { bold: true };
      cell.border = { top: { style: "thin", color: { argb: "FF333333" } } };
    });
    cursor += 1;
  }

  // Width from the widest of header/sample values, clamped to something sane.
  payload.columns.forEach((col, i) => {
    const sample = payload.rows.slice(0, 200).map((r) => String(r[col.key] ?? "").length);
    const widest = Math.max(col.label.length, ...(sample.length ? sample : [0]));
    ws.getColumn(i + 1).width = Math.min(42, Math.max(10, widest + 2));
  });

  // Freeze the header and enable filtering, so large exports stay usable.
  ws.views = [{ state: "frozen", ySplit: headerRowIndex }];
  if (payload.rows.length > 0) {
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex + payload.rows.length, column: payload.columns.length },
    };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Filename-safe slug, e.g. "Sales Register" → "sales-register". */
export function exportFilename(title: string, format: ExportFormat): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stamp = new Date().toISOString().slice(0, 10);
  return `${slug || "export"}-${stamp}.${format}`;
}

export async function buildExportResponse(payload: ExportPayload, format: ExportFormat): Promise<Response> {
  const filename = exportFilename(payload.title, format);

  if (format === "csv") {
    return new Response(toCsv(payload), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  const buffer = await toXlsx(payload);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

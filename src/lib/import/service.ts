import ExcelJS from "exceljs";
import mongoose, { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { getResource } from "@/lib/resources/registry";
import { TenantRepository } from "@/lib/repositories/TenantRepository";
import { getNextMasterCode } from "@/lib/services/masterNumberingService";
import { recordAudit } from "@/lib/services/auditService";
import { setPath, getPath } from "@/lib/resources/ui/paths";
import { getImportDefinition } from "./registry";
import type {
  ImportCommitResult,
  ImportDefinition,
  ImportPreviewResult,
  ImportPreviewRow,
  ImportRowError,
} from "./types";
import type { AuthContext } from "@/lib/auth/context";

/** Refuse absurd files up front rather than parsing them into memory. */
export const MAX_IMPORT_ROWS = 2000;

interface ParsedSheet {
  headers: string[];
  /** Each row paired with its 1-based line number in the original file. */
  rows: { rowNumber: number; cells: Record<string, string> }[];
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        // Doubled quote inside a quoted field is a literal quote.
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map((v) => v.trim());
}

function parseCsv(text: string): ParsedSheet {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]);
  const rows = lines.slice(1).map((line, i) => {
    const cells = splitCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = cells[idx] ?? "";
    });
    // +2: row 1 is the header, and the data starts on row 2.
    return { rowNumber: i + 2, cells: record };
  });

  return { headers, rows };
}

async function parseXlsx(buffer: Buffer): Promise<ParsedSheet> {
  const wb = new ExcelJS.Workbook();
  // exceljs types expect the DOM Buffer shape; a Node Buffer is a Uint8Array
  // view over the same bytes, which load() accepts at runtime.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  // Prefer a sheet named "Data" (what our template produces); else the first.
  const ws = wb.getWorksheet("Data") ?? wb.worksheets[0];
  if (!ws) return { headers: [], rows: [] };

  const headerRow = ws.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = String(cell.value ?? "").trim();
  });

  const rows: ParsedSheet["rows"] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;

    const record: Record<string, string> = {};
    let hasValue = false;

    headers.forEach((h, idx) => {
      if (!h) return;
      const cell = row.getCell(idx + 1);
      let value = cell.value;

      // Excel surfaces formula cells and rich text as objects.
      if (value && typeof value === "object") {
        if ("result" in value) value = (value as { result: unknown }).result as never;
        else if ("richText" in value) {
          value = (value as { richText: { text: string }[] }).richText.map((r) => r.text).join("") as never;
        } else if (value instanceof Date) {
          value = value.toISOString().slice(0, 10) as never;
        }
      }

      const text = value === null || value === undefined ? "" : String(value).trim();
      record[h] = text;
      if (text !== "") hasValue = true;
    });

    if (hasValue) rows.push({ rowNumber, cells: record });
  });

  return { headers: headers.filter(Boolean), rows };
}

export async function parseImportFile(file: File): Promise<ParsedSheet> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".csv")) return parseCsv(buffer.toString("utf8"));
  if (name.endsWith(".xlsx")) return parseXlsx(buffer);

  throw AppError.badRequest("Upload a .xlsx or .csv file", "UNSUPPORTED_FILE");
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

function coerce(value: string, type?: string): unknown {
  if (value === "") return undefined;
  if (type === "number") return Number(value);
  // Money stays a string all the way to the schema (decimal precision).
  if (type === "money") return value;
  if (type === "boolean") return ["true", "yes", "y", "1"].includes(value.toLowerCase());
  return value;
}

/**
 * Validates every row and returns a preview. Nothing is written here — the
 * user sees exactly what will happen, with per-row/per-column errors, before
 * committing.
 */
export async function previewImport(
  resource: string,
  sheet: ParsedSheet,
  ctx: AuthContext
): Promise<ImportPreviewResult> {
  const def = getImportDefinition(resource);
  const resourceDef = getResource(resource === "customers" ? "customers" : resource);
  if (!def) throw AppError.notFound("This module does not support import");

  if (sheet.rows.length > MAX_IMPORT_ROWS) {
    throw AppError.badRequest(
      `The file has ${sheet.rows.length} rows, above the ${MAX_IMPORT_ROWS}-row limit. Split it into smaller files.`,
      "IMPORT_TOO_LARGE"
    );
  }

  const fileErrors: ImportRowError[] = [];
  const missingHeaders = def.fields
    .filter((f) => f.required && !sheet.headers.includes(f.header))
    .map((f) => f.header);

  if (missingHeaders.length > 0) {
    fileErrors.push({
      row: 1,
      message: `Missing required column(s): ${missingHeaders.join(", ")}. Download the sample template for the expected format.`,
    });
  }

  // Resolve every lookup (category name → id) in one pass per resource
  // rather than a query per row.
  const lookupMaps = new Map<string, Map<string, string>>();
  for (const field of def.fields) {
    if (!field.lookup || lookupMaps.has(field.lookup.resource)) continue;
    const lookupDef = getResource(field.lookup.resource);
    if (!lookupDef) continue;

    const repo = new TenantRepository(lookupDef.model);
    const docs = await repo.find(ctx.businessId, { deletedAt: null });
    const map = new Map<string, string>();
    for (const d of docs) {
      const key = String(d[field.lookup.matchField] ?? "").trim().toLowerCase();
      if (key) map.set(key, d._id.toString());
    }
    lookupMaps.set(field.lookup.resource, map);
  }

  // Existing records for duplicate detection.
  const existing = new Set<string>();
  if (def.duplicateKey && resourceDef) {
    const repo = new TenantRepository(resourceDef.model);
    const docs = await repo.find(ctx.businessId, { deletedAt: null });
    for (const d of docs) {
      const value = getPath(d.toObject ? d.toObject() : d, def.duplicateKey.path);
      if (value) existing.add(String(value).trim().toLowerCase());
    }
  }

  const seenInFile = new Set<string>();
  const rows: ImportPreviewRow[] = [];

  for (const raw of sheet.rows) {
    const errors: ImportRowError[] = [];
    let payload: Record<string, unknown> = {};

    for (const field of def.fields) {
      const cell = (raw.cells[field.header] ?? "").trim();

      if (field.required && cell === "") {
        errors.push({ row: raw.rowNumber, column: field.header, message: `${field.header} is required` });
        continue;
      }
      if (cell === "") continue;

      if (field.lookup) {
        const map = lookupMaps.get(field.lookup.resource);
        const id = map?.get(cell.toLowerCase());
        if (!id) {
          errors.push({
            row: raw.rowNumber,
            column: field.header,
            message: `${field.lookup.label} "${cell}" does not exist — create it first or correct the spelling`,
          });
          continue;
        }
        payload = setPath(payload, field.path, id);
        continue;
      }

      if (field.type === "number" && Number.isNaN(Number(cell))) {
        errors.push({ row: raw.rowNumber, column: field.header, message: `"${cell}" is not a valid number` });
        continue;
      }
      if (field.type === "money" && !/^-?\d+(\.\d{1,4})?$/.test(cell)) {
        errors.push({ row: raw.rowNumber, column: field.header, message: `"${cell}" is not a valid amount` });
        continue;
      }

      payload = setPath(payload, field.path, coerce(cell, field.type));
    }

    // Run the real create schema so an import can never bypass the same
    // validation a manual entry goes through (GSTIN checksum, lengths, enums).
    if (errors.length === 0 && resourceDef) {
      const parsed = resourceDef.createSchema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const path = issue.path.join(".");
          const field = def.fields.find((f) => f.path === path);
          errors.push({
            row: raw.rowNumber,
            column: field?.header ?? path,
            message: issue.message,
          });
        }
      } else {
        payload = parsed.data as Record<string, unknown>;
      }
    }

    // Duplicates — against the database and within the file itself.
    let duplicate = false;
    if (def.duplicateKey) {
      const value = String(getPath(payload, def.duplicateKey.path) ?? "").trim().toLowerCase();
      if (value) {
        if (existing.has(value)) duplicate = true;
        if (seenInFile.has(value)) {
          errors.push({
            row: raw.rowNumber,
            column: def.duplicateKey.header,
            message: `"${value}" appears more than once in this file`,
          });
        }
        seenInFile.add(value);
      }
    }

    rows.push({ row: raw.rowNumber, values: payload, errors, duplicate });
  }

  const errorRows = rows.filter((r) => r.errors.length > 0).length;
  const duplicateRows = rows.filter((r) => r.duplicate && r.errors.length === 0).length;

  return {
    resource,
    title: def.title,
    totalRows: rows.length,
    validRows: rows.length - errorRows - duplicateRows,
    errorRows,
    duplicateRows,
    rows,
    errors: [...fileErrors, ...rows.flatMap((r) => r.errors)],
    detectedHeaders: sheet.headers,
    missingHeaders,
  };
}

/* ------------------------------------------------------------------ */
/* Commit                                                              */
/* ------------------------------------------------------------------ */

/**
 * Writes the previewed rows. The whole file is committed inside one MongoDB
 * transaction: if any row fails, nothing is written. A partially-imported
 * master file is far harder to clean up than a rejected one.
 */
export async function commitImport(
  resource: string,
  sheet: ParsedSheet,
  ctx: AuthContext,
  options: { skipDuplicates: boolean }
): Promise<ImportCommitResult> {
  const def = getImportDefinition(resource);
  const resourceDef = getResource(resource);
  if (!def || !resourceDef) throw AppError.notFound("This module does not support import");

  const preview = await previewImport(resource, sheet, ctx);

  if (preview.errorRows > 0 || preview.missingHeaders.length > 0) {
    throw AppError.badRequest(
      `Cannot import: ${preview.errorRows} row(s) still have errors. Fix them and upload again — nothing has been saved.`,
      "IMPORT_HAS_ERRORS"
    );
  }

  const toInsert = preview.rows.filter((r) => !(r.duplicate && options.skipDuplicates));
  const blockedDuplicates = preview.rows.filter((r) => r.duplicate && !options.skipDuplicates);

  if (blockedDuplicates.length > 0) {
    throw AppError.conflict(
      `${blockedDuplicates.length} row(s) already exist (rows ${blockedDuplicates
        .map((r) => r.row)
        .slice(0, 10)
        .join(", ")}). Choose "skip duplicates" or remove them — nothing has been saved.`,
      "IMPORT_DUPLICATES"
    );
  }

  if (toInsert.length === 0) {
    return { resource, imported: 0, skippedDuplicates: preview.rows.length };
  }

  const session = await mongoose.startSession();
  let imported = 0;

  try {
    await session.withTransaction(async () => {
      for (const row of toInsert) {
        const payload = resourceDef.toDocument
          ? resourceDef.toDocument(row.values)
          : { ...row.values };

        if (resourceDef.autoCode && !payload[resourceDef.autoCode.field]) {
          payload[resourceDef.autoCode.field] = await getNextMasterCode({
            businessId: ctx.businessId,
            entityType: resourceDef.autoCode.entityType,
            prefix: resourceDef.autoCode.prefix,
          });
        }

        payload.businessId = ctx.businessId;
        payload.createdBy = ctx.userId;
        payload.updatedBy = ctx.userId;

        await resourceDef.model.create([payload], { session });
        imported += 1;
      }
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: `import.${resource}`,
    documentType: def.title,
    newValue: { imported, skippedDuplicates: preview.rows.length - toInsert.length },
  });

  return { resource, imported, skippedDuplicates: preview.rows.length - toInsert.length };
}

/* ------------------------------------------------------------------ */
/* Template                                                            */
/* ------------------------------------------------------------------ */

/** Sample .xlsx template: an instructions sheet plus a Data sheet with the
 *  exact headers the importer expects and one example row. */
export async function buildImportTemplate(def: ImportDefinition): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const info = wb.addWorksheet("Instructions");
  info.getCell("A1").value = `${def.title} — import template`;
  info.getCell("A1").font = { bold: true, size: 14 };
  info.getCell("A3").value =
    "Fill in the Data sheet. Keep the header row exactly as it is — columns are matched by header name.";
  info.getCell("A4").value =
    "The example row is for reference only; delete it before uploading. Required columns must not be blank.";
  info.getColumn(1).width = 28;
  info.getColumn(2).width = 12;
  info.getColumn(3).width = 70;

  info.getRow(6).values = ["Column", "Required", "Notes"];
  info.getRow(6).font = { bold: true };

  def.fields.forEach((f, i) => {
    const row = info.getRow(7 + i);
    row.values = [f.header, f.required ? "Yes" : "No", f.hint ?? ""];
  });

  const data = wb.addWorksheet("Data");
  data.columns = def.fields.map((f) => ({
    header: f.header,
    key: f.header,
    width: Math.min(32, Math.max(14, f.header.length + 4)),
  }));
  data.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  data.getRow(1).eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B4A6B" } };
  });
  data.views = [{ state: "frozen", ySplit: 1 }];

  const example: Record<string, string> = {};
  for (const f of def.fields) example[f.header] = f.example ?? "";
  data.addRow(example);

  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { Types };

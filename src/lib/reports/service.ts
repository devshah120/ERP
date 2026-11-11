import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import { getReport, listReports, REPORTS } from "./registry";
import { reportQuerySchema } from "./types";
import type { ReportColumnDef, ReportContext, ReportQuery, ReportRow } from "./types";

export { reportQuerySchema, getReport, listReports, REPORTS };
export type { ReportQuery, ReportColumnDef };

export interface ReportResult {
  key: string;
  title: string;
  module: string;
  description: string;
  /** Every column the report can produce — drives the column picker. */
  availableColumns: ReportColumnDef[];
  /** The columns actually returned, in order. */
  columns: ReportColumnDef[];
  rows: ReportRow[];
  /** Footer totals for the rows on this page (see note below). */
  totals: Record<string, string>;
  summary: { label: string; value: string }[];
  filters: string[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Resolves which columns the caller asked for. An explicit `columns` list
 * wins; otherwise the report's defaults are used. Unknown keys are ignored
 * rather than erroring, so a stale saved selection degrades gracefully.
 */
function resolveColumns(all: ReportColumnDef[], requested?: string): ReportColumnDef[] {
  if (!requested) return all.filter((c) => c.defaultVisible !== false);

  const wanted = new Set(
    requested
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const chosen = all.filter((c) => wanted.has(c.key));

  // Never return a report with no columns at all.
  return chosen.length > 0 ? chosen : all.filter((c) => c.defaultVisible !== false);
}

function computeTotals(rows: ReportRow[], columns: ReportColumnDef[]): Record<string, string> {
  const totals: Record<string, string> = {};

  for (const col of columns) {
    if (!col.total) continue;

    if (col.type === "number") {
      const sum = rows.reduce((acc, r) => acc + Number(r[col.key] ?? 0), 0);
      // Keep integers looking like integers (quantities), not "12.00".
      totals[col.key] = Number.isInteger(sum) ? String(sum) : sum.toFixed(2);
    } else {
      totals[col.key] = rows
        .reduce<Decimal>((acc, r) => acc.plus(String(r[col.key] ?? 0)), new Decimal(0))
        .toFixed(2);
    }
  }

  return totals;
}

/**
 * Runs a report and returns only the columns the user selected.
 *
 * Projection happens server-side so the API response, the on-screen table and
 * any export all contain exactly the same fields — a client-side hide would
 * leave unselected data in the payload and let exports drift from the view.
 *
 * Note on totals: `summary` tiles are aggregated across *all* matching
 * records, while `totals` is the footer row for the current page. They are
 * deliberately different figures and are labelled as such in the UI.
 */
export async function runReport(
  key: string,
  ctx: ReportContext,
  query: ReportQuery
): Promise<ReportResult> {
  const def = getReport(key);
  if (!def) throw AppError.notFound("Unknown report");

  const result = await def.run(ctx, query);
  const columns = resolveColumns(def.columns, query.columns);

  const rows = result.rows.map((row) => {
    const projected: ReportRow = {};
    for (const col of columns) {
      projected[col.key] = row[col.key];
      // Carry the drill-through target for link columns.
      const href = row[`${col.key}Href`];
      if (href !== undefined) projected[`${col.key}Href`] = href;
    }
    return projected;
  });

  return {
    key: def.key,
    title: def.title,
    module: def.module,
    description: def.description,
    availableColumns: def.columns,
    columns,
    rows,
    totals: computeTotals(rows, columns),
    summary: result.summary ?? [],
    filters: def.filters,
    total: result.total ?? result.rows.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

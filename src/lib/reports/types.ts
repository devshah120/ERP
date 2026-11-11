import { z } from "zod";

export const reportQuerySchema = z.object({
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  partyName: z.string().trim().max(200).optional(),
  itemName: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
  warehouseId: z.string().trim().optional(),
  /** Ledger reports: which account to show postings for. */
  accountId: z.string().trim().optional(),
  /** Stock-summary drill-through from the dashboard: LOW = at or below the
   *  reorder level, OUT = nothing on hand, NEGATIVE = issued more than received. */
  stockFilter: z.enum(["LOW", "OUT", "NEGATIVE"]).optional(),
  /** Comma-separated column keys the user selected. Empty = report defaults. */
  columns: z.string().trim().max(2000).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});
export type ReportQuery = z.infer<typeof reportQuerySchema>;

export type ReportColumnType = "text" | "date" | "datetime" | "money" | "number" | "status" | "link";

export interface ReportColumnDef {
  key: string;
  label: string;
  type?: ReportColumnType;
  /** Shown when the user hasn't chosen columns yet. Defaults to true. */
  defaultVisible?: boolean;
  /** Include this column in the footer totals row. */
  total?: boolean;
}

export type ReportFilterKey = "dateRange" | "party" | "item" | "status" | "warehouse" | "account";

/** A row as produced by a report's runner: every catalogue column, plus
 *  optional `<key>Href` entries that turn a cell into a drill-through link. */
export type ReportRow = Record<string, unknown>;

export interface ReportRunResult {
  rows: ReportRow[];
  /** Total matching records (for paging); defaults to rows.length. */
  total?: number;
  /** Extra headline figures shown as tiles above the table. */
  summary?: { label: string; value: string }[];
}

export interface ReportDefinition {
  key: string;
  title: string;
  /** Grouping on the reports index, e.g. "Sales". */
  module: string;
  description: string;
  columns: ReportColumnDef[];
  filters: ReportFilterKey[];
  run: (ctx: ReportContext, query: ReportQuery) => Promise<ReportRunResult>;
}

/** Minimal slice of the auth context the report runners need. */
export interface ReportContext {
  businessId: import("mongoose").Types.ObjectId;
}

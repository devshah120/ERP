import { AppError } from "@/lib/errors/AppError";
import type { ExportFormat } from "./exporter";

/**
 * Upper bound on rows in a single export. Large enough for a full financial
 * year of documents, small enough that one request can't exhaust memory.
 *
 * Deliberately higher than the interactive list caps: an export is meant to
 * contain the whole filtered set, not one screen of it. If the data exceeds
 * this, the export fails loudly (see assertNotTruncated) rather than handing
 * back a file that is quietly missing rows — silent truncation in an
 * accounting export is far worse than an error.
 */
export const EXPORT_PAGE_SIZE = 5000;

export function assertNotTruncated(total: number, returned: number): void {
  if (total > returned) {
    throw AppError.badRequest(
      `This export would contain ${total.toLocaleString()} rows, which is above the ${EXPORT_PAGE_SIZE.toLocaleString()} limit. Narrow the date range or filters and try again.`,
      "EXPORT_TOO_LARGE"
    );
  }
}

export function resolveFormat(raw?: string): ExportFormat {
  const value = (raw ?? "xlsx").toLowerCase();
  if (value !== "csv" && value !== "xlsx") {
    throw AppError.badRequest("Export format must be csv or xlsx", "INVALID_FORMAT");
  }
  return value;
}

const FILTER_LABELS: Record<string, string> = {
  query: "Search",
  fromDate: "From",
  toDate: "To",
  partyName: "Party",
  customerName: "Party",
  itemName: "Item",
  status: "Status",
  documentNumber: "Document no",
  warehouseId: "Warehouse",
};

/** One-line description of the applied filters, written into the file so a
 *  shared export is self-explanatory rather than a context-free grid. */
export function describeFilters(params: Record<string, string>): string | undefined {
  const parts: string[] = [];

  for (const [key, label] of Object.entries(FILTER_LABELS)) {
    const value = params[key];
    if (value) parts.push(`${label}: ${value}`);
  }

  // Per-column filters from the masters framework (name, code, city, ...).
  const known = new Set([...Object.keys(FILTER_LABELS), "format", "page", "pageSize", "columns", "sortBy", "sortDir"]);
  for (const [key, value] of Object.entries(params)) {
    if (!known.has(key) && value) parts.push(`${key}: ${value}`);
  }

  const generated = `Generated ${new Date().toLocaleString("en-GB")}`;
  return parts.length > 0 ? `Filters — ${parts.join(" · ")} · ${generated}` : generated;
}

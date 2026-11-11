import Decimal from "decimal.js";
import type { ReportQuery } from "./types";

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function money(value: unknown): string {
  return new Decimal(String(value ?? 0)).toFixed(2);
}

export function dateFilter(query: ReportQuery) {
  if (!query.fromDate && !query.toDate) return undefined;
  const range: Record<string, Date> = {};
  if (query.fromDate) range.$gte = new Date(query.fromDate);
  if (query.toDate) {
    const to = new Date(query.toDate);
    to.setHours(23, 59, 59, 999);
    range.$lte = to;
  }
  return range;
}

export function sumDecimal(values: unknown[]): string {
  return values.reduce<Decimal>((acc, v) => acc.plus(String(v ?? 0)), new Decimal(0)).toFixed(2);
}

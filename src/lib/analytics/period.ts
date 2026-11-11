import { AppError } from "@/lib/errors/AppError";
import type { AnalyticsQuery, PeriodKey } from "./types";

export interface ResolvedPeriod {
  key: PeriodKey;
  label: string;
  from: Date;
  to: Date;
  /** Same length, immediately before `from` — used for period-on-period deltas. */
  previousFrom: Date;
  previousTo: Date;
  /** Day buckets for short ranges, month buckets for long ones. */
  bucket: "day" | "month";
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/**
 * Turns a period preset into a concrete range.
 *
 * Ranges are half-open on neither end — they run from 00:00:00.000 to
 * 23:59:59.999 in the server's local zone, matching how the rest of the app
 * filters by `documentDate`, so a dashboard figure and the list it links to
 * always cover exactly the same days.
 */
export function resolvePeriod(query: AnalyticsQuery, now = new Date()): ResolvedPeriod {
  let from: Date;
  let to = endOfDay(now);
  let label: string;

  switch (query.period) {
    case "today":
      from = startOfDay(now);
      label = "Today";
      break;
    case "week": {
      // Week starts Monday — the Indian business week, and what the rest of
      // the reports assume.
      const day = (now.getDay() + 6) % 7;
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - day));
      label = "This week";
      break;
    }
    case "month":
      from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      label = "This month";
      break;
    case "quarter": {
      const q = Math.floor(now.getMonth() / 3);
      from = startOfDay(new Date(now.getFullYear(), q * 3, 1));
      label = "This quarter";
      break;
    }
    case "year":
      from = startOfDay(new Date(now.getFullYear(), 0, 1));
      label = "This year";
      break;
    case "custom": {
      if (!query.fromDate || !query.toDate) {
        throw AppError.badRequest("A custom period needs both fromDate and toDate", "PERIOD_INCOMPLETE");
      }
      from = startOfDay(new Date(query.fromDate));
      to = endOfDay(new Date(query.toDate));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw AppError.badRequest("Invalid custom date range", "PERIOD_INVALID");
      }
      if (from > to) throw AppError.badRequest("fromDate must not be after toDate", "PERIOD_INVERTED");
      label = "Custom range";
      break;
    }
  }

  const spanMs = to.getTime() - from.getTime();
  const previousTo = new Date(from.getTime() - 1);
  const previousFrom = new Date(previousTo.getTime() - spanMs);

  const spanDays = spanMs / 86_400_000;
  return {
    key: query.period,
    label,
    from,
    to,
    previousFrom,
    previousTo,
    bucket: spanDays > 92 ? "month" : "day",
  };
}

/** `YYYY-MM-DD` in local time — safe to hand straight to a date input or a
 *  list filter, unlike toISOString() which would shift across midnight. */
export function toDateParam(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function periodParams(period: ResolvedPeriod): string {
  return `fromDate=${toDateParam(period.from)}&toDate=${toDateParam(period.to)}`;
}

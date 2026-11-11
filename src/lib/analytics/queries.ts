import { Types, type Model } from "mongoose";
import Decimal from "decimal.js";
import type { ResolvedPeriod } from "./period";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/** Decimal128 / number / null → a fixed 2dp decimal string. */
export function dec(value: unknown): string {
  return new Decimal(String(value ?? 0)).toFixed(2);
}

export function num(value: unknown): number {
  return Number(new Decimal(String(value ?? 0)).toFixed(2));
}

/**
 * A cancelled document has no financial effect, so every figure on the
 * dashboard excludes it. Drafts are excluded from *value* figures for the
 * same reason but still counted where the question is "how many were
 * raised", which is why callers choose the status set explicitly.
 */
export const LIVE_STATUS = { $ne: "CANCELLED" };

export function dateRange(period: ResolvedPeriod) {
  return { $gte: period.from, $lte: period.to };
}

export function baseFilter(businessId: Types.ObjectId, period?: ResolvedPeriod) {
  const filter: Record<string, unknown> = { businessId, status: LIVE_STATUS };
  if (period) filter.documentDate = dateRange(period);
  return filter;
}

/* ------------------------------------------------------------------ */
/* Invoices: counts, values and collection                             */
/* ------------------------------------------------------------------ */

export interface InvoiceSummary {
  /** Number of invoices — never mixed with the money figures below. */
  count: number;
  grandTotal: string;
  taxableAmount: string;
  taxAmount: string;
  paidAmount: string;
  dueAmount: string;
  paidCount: number;
  partiallyPaidCount: number;
  unpaidCount: number;
  /** Count of invoices with any money against them (paid or partly paid). */
  settledCount: number;
  collectionPercent: string;
}

export async function invoiceSummary(
  model: AnyModel,
  businessId: Types.ObjectId,
  period?: ResolvedPeriod
): Promise<InvoiceSummary> {
  // Only posted invoices carry a receivable; a draft is not yet a claim on
  // anyone, so including it would overstate both sales and outstanding.
  const filter = {
    ...baseFilter(businessId, period),
    status: { $nin: ["CANCELLED", "DRAFT"] },
  };

  const rows = await model.aggregate([
    { $match: filter },
    {
      $group: {
        _id: "$paymentStatus",
        count: { $sum: 1 },
        grandTotal: { $sum: "$totals.grandTotal" },
        taxableAmount: { $sum: "$totals.taxableAmount" },
        taxAmount: { $sum: "$totals.totalTax" },
        paidAmount: { $sum: "$paidAmount" },
        dueAmount: { $sum: "$dueAmount" },
      },
    },
  ]);

  const zero = new Decimal(0);
  let count = 0;
  let grand = zero;
  let taxable = zero;
  let tax = zero;
  let paid = zero;
  let due = zero;
  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  for (const r of rows as AnyDoc[]) {
    count += r.count;
    grand = grand.plus(String(r.grandTotal ?? 0));
    taxable = taxable.plus(String(r.taxableAmount ?? 0));
    tax = tax.plus(String(r.taxAmount ?? 0));
    paid = paid.plus(String(r.paidAmount ?? 0));
    due = due.plus(String(r.dueAmount ?? 0));
    if (r._id === "PAID") paidCount = r.count;
    else if (r._id === "PARTIALLY_PAID") partialCount = r.count;
    else unpaidCount += r.count;
  }

  return {
    count,
    grandTotal: grand.toFixed(2),
    taxableAmount: taxable.toFixed(2),
    taxAmount: tax.toFixed(2),
    paidAmount: paid.toFixed(2),
    dueAmount: due.toFixed(2),
    paidCount,
    partiallyPaidCount: partialCount,
    unpaidCount,
    settledCount: paidCount + partialCount,
    collectionPercent: grand.gt(0) ? paid.div(grand).times(100).toFixed(1) : "0.0",
  };
}

/* ------------------------------------------------------------------ */
/* Orders: how much of what was ordered has actually flowed on          */
/* ------------------------------------------------------------------ */

export interface ConversionSummary {
  total: number;
  fullyConverted: number;
  partiallyConverted: number;
  notConverted: number;
  /** fullyConverted + partiallyConverted — "has started converting". */
  converted: number;
  pending: number;
  orderValue: string;
  /**
   * Value of the quantity still to be invoiced/delivered, taken as each
   * line's total scaled by its outstanding share of quantity. Exact for
   * percentage discounts; a close estimate where a flat per-line discount
   * was used.
   */
  pendingValue: string;
  conversionPercent: string;
}

export async function conversionSummary(
  model: AnyModel,
  businessId: Types.ObjectId,
  field: "invoicedQty" | "deliveredQty",
  period?: ResolvedPeriod
): Promise<ConversionSummary> {
  // A draft order has not been placed with anyone yet, so it is not a
  // conversion failure — only confirmed-and-later orders are judged.
  const filter = {
    ...baseFilter(businessId, period),
    status: { $nin: ["CANCELLED", "DRAFT", "REJECTED", "EXPIRED"] },
  };

  const rows = await model.aggregate([
    { $match: filter },
    {
      $addFields: {
        __ordered: { $sum: "$lines.quantity" },
        __done: { $sum: `$lines.${field}` },
        __pendingValue: {
          $sum: {
            $map: {
              input: "$lines",
              as: "l",
              in: {
                $cond: [
                  { $gt: ["$$l.quantity", 0] },
                  {
                    $multiply: [
                      "$$l.lineTotal",
                      {
                        $divide: [
                          { $max: [0, { $subtract: ["$$l.quantity", `$$l.${field}`] }] },
                          "$$l.quantity",
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            },
          },
        },
      },
    },
    {
      $group: {
        _id: {
          $cond: [
            { $lte: ["$__ordered", "$__done"] },
            "FULL",
            { $cond: [{ $gt: ["$__done", 0] }, "PARTIAL", "NONE"] },
          ],
        },
        count: { $sum: 1 },
        orderValue: { $sum: "$totals.grandTotal" },
        pendingValue: { $sum: "$__pendingValue" },
      },
    },
  ]);

  let full = 0;
  let partial = 0;
  let none = 0;
  let orderValue = new Decimal(0);
  let pendingValue = new Decimal(0);

  for (const r of rows as AnyDoc[]) {
    if (r._id === "FULL") full = r.count;
    else if (r._id === "PARTIAL") partial = r.count;
    else none = r.count;
    orderValue = orderValue.plus(String(r.orderValue ?? 0));
    pendingValue = pendingValue.plus(String(r.pendingValue ?? 0));
  }

  const total = full + partial + none;
  return {
    total,
    fullyConverted: full,
    partiallyConverted: partial,
    notConverted: none,
    converted: full + partial,
    pending: partial + none,
    orderValue: orderValue.toFixed(2),
    pendingValue: pendingValue.toFixed(2),
    conversionPercent: total > 0 ? new Decimal(full).div(total).times(100).toFixed(1) : "0.0",
  };
}

/* ------------------------------------------------------------------ */
/* Aging                                                               */
/* ------------------------------------------------------------------ */

export interface AgingBucket {
  label: string;
  /** Number of invoices in the bucket. */
  count: number;
  amount: string;
  /** Lower bound in days, for the drill-through link. */
  minDays: number;
  maxDays: number | null;
}

/**
 * Outstanding money grouped by how long it has been owed.
 *
 * Aging is deliberately computed **as of today across all open invoices**,
 * not restricted to the selected period: money owed from March is still
 * owed in September, and hiding it when the filter says "this month" is
 * exactly the error that lets receivables rot.
 */
export async function agingBuckets(
  model: AnyModel,
  businessId: Types.ObjectId,
  now = new Date()
): Promise<AgingBucket[]> {
  const rows = await model.aggregate([
    {
      $match: {
        businessId,
        status: { $nin: ["CANCELLED", "DRAFT"] },
        paymentStatus: { $ne: "PAID" },
      },
    },
    {
      $addFields: {
        // Undated invoices age from their own document date — the debt
        // exists whether or not anyone set terms.
        __age: {
          $dateDiff: {
            startDate: { $ifNull: ["$dueDate", "$documentDate"] },
            endDate: now,
            unit: "day",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          $switch: {
            branches: [
              { case: { $lte: ["$__age", 30] }, then: "0-30" },
              { case: { $lte: ["$__age", 60] }, then: "31-60" },
              { case: { $lte: ["$__age", 90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
        count: { $sum: 1 },
        amount: { $sum: "$dueAmount" },
      },
    },
  ]);

  const shape: AgingBucket[] = [
    { label: "0-30 days", count: 0, amount: "0.00", minDays: 0, maxDays: 30 },
    { label: "31-60 days", count: 0, amount: "0.00", minDays: 31, maxDays: 60 },
    { label: "61-90 days", count: 0, amount: "0.00", minDays: 61, maxDays: 90 },
    { label: "90+ days", count: 0, amount: "0.00", minDays: 91, maxDays: null },
  ];
  const index: Record<string, number> = { "0-30": 0, "31-60": 1, "61-90": 2, "90+": 3 };

  for (const r of rows as AnyDoc[]) {
    const i = index[r._id as string];
    if (i === undefined) continue;
    shape[i].count = r.count;
    shape[i].amount = dec(r.amount);
  }
  return shape;
}

/* ------------------------------------------------------------------ */
/* Trends                                                              */
/* ------------------------------------------------------------------ */

export interface TrendPoint {
  label: string;
  /** Bucket start, as YYYY-MM-DD, for the drill-through link. */
  from: string;
  to: string;
  value: number;
  count: number;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Value per day (or per month for long ranges), with empty buckets filled
 * in — a gap in a trend line must read as "nothing happened", not as a
 * missing point the eye will interpolate across.
 */
export async function trend(
  model: AnyModel,
  businessId: Types.ObjectId,
  period: ResolvedPeriod,
  options: { excludeDraft?: boolean } = {}
): Promise<TrendPoint[]> {
  const filter: Record<string, unknown> = {
    businessId,
    documentDate: dateRange(period),
    status: options.excludeDraft ? { $nin: ["CANCELLED", "DRAFT"] } : LIVE_STATUS,
  };

  const byMonth = period.bucket === "month";
  const rows = await model.aggregate([
    { $match: filter },
    {
      $group: {
        _id: byMonth
          ? { y: { $year: "$documentDate" }, m: { $month: "$documentDate" } }
          : { y: { $year: "$documentDate" }, m: { $month: "$documentDate" }, d: { $dayOfMonth: "$documentDate" } },
        value: { $sum: "$totals.grandTotal" },
        count: { $sum: 1 },
      },
    },
  ]);

  const map = new Map<string, { value: number; count: number }>();
  for (const r of rows as AnyDoc[]) {
    const key = byMonth
      ? `${r._id.y}-${pad(r._id.m)}`
      : `${r._id.y}-${pad(r._id.m)}-${pad(r._id.d)}`;
    map.set(key, { value: num(r.value), count: r.count });
  }

  const points: TrendPoint[] = [];
  if (byMonth) {
    const cursor = new Date(period.from.getFullYear(), period.from.getMonth(), 1);
    while (cursor <= period.to) {
      const key = `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`;
      const hit = map.get(key) ?? { value: 0, count: 0 };
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      points.push({
        label: `${MONTH_NAMES[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`,
        from: dateKey(cursor),
        to: dateKey(last),
        value: hit.value,
        count: hit.count,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  } else {
    const cursor = new Date(period.from);
    cursor.setHours(0, 0, 0, 0);
    while (cursor <= period.to) {
      const key = dateKey(cursor);
      const hit = map.get(key) ?? { value: 0, count: 0 };
      points.push({
        label: `${cursor.getDate()} ${MONTH_NAMES[cursor.getMonth()]}`,
        from: key,
        to: key,
        value: hit.value,
        count: hit.count,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  return points;
}

/* ------------------------------------------------------------------ */
/* Leaderboards                                                        */
/* ------------------------------------------------------------------ */

export interface RankedRow {
  id: string;
  name: string;
  count: number;
  value: string;
  quantity?: number;
}

/** Top trading partners by invoiced value in the period. */
export async function topParties(
  model: AnyModel,
  businessId: Types.ObjectId,
  partyField: "customer" | "vendor",
  period: ResolvedPeriod,
  limit = 5
): Promise<RankedRow[]> {
  const idField = partyField === "customer" ? "$customerId" : "$vendorId";
  const rows = await model.aggregate([
    { $match: { ...baseFilter(businessId, period), status: { $nin: ["CANCELLED", "DRAFT"] } } },
    {
      $group: {
        _id: idField,
        name: { $first: `$${partyField}.name` },
        count: { $sum: 1 },
        value: { $sum: "$totals.grandTotal" },
      },
    },
    { $sort: { value: -1 } },
    { $limit: limit },
  ]);

  return (rows as AnyDoc[]).map((r) => ({
    id: r._id?.toString() ?? "",
    name: r.name ?? "—",
    count: r.count,
    value: dec(r.value),
  }));
}

/** Top products by invoiced value, rolled up across document lines. */
export async function topItems(
  model: AnyModel,
  businessId: Types.ObjectId,
  period: ResolvedPeriod,
  limit = 5
): Promise<RankedRow[]> {
  const rows = await model.aggregate([
    { $match: { ...baseFilter(businessId, period), status: { $nin: ["CANCELLED", "DRAFT"] } } },
    { $unwind: "$lines" },
    {
      $group: {
        _id: "$lines.itemId",
        name: { $first: "$lines.itemName" },
        quantity: { $sum: "$lines.quantity" },
        value: { $sum: "$lines.lineTotal" },
        // Distinct documents, so an item appearing on two lines of one
        // invoice is not counted as two sales.
        docs: { $addToSet: "$_id" },
      },
    },
    { $sort: { value: -1 } },
    { $limit: limit },
  ]);

  return (rows as AnyDoc[]).map((r) => ({
    id: r._id?.toString() ?? "",
    name: r.name ?? "—",
    count: r.docs?.length ?? 0,
    quantity: r.quantity,
    value: dec(r.value),
  }));
}

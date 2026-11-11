import { Types, type Model } from "mongoose";
import Decimal from "decimal.js";
import { SalesInvoice, SalesReturn } from "@/models/salesDocuments";
import { PurchaseInvoice, PurchaseReturn } from "@/models/purchaseDocuments";
import { Payment } from "@/models/Payment";
import { Item } from "@/models/Item";
import { Category } from "@/models/Category";
import { resolvePeriod, type ResolvedPeriod } from "./period";
import { dec } from "./queries";
import type { AnalyticsQuery } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = Model<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/**
 * Data behind the dashboard's operational panels: period-on-period deltas,
 * payment-mode mix, per-party aging, customer segments, category mix and
 * item performance. Read-only aggregations over the same documents the rest
 * of analytics reads, with the same rules: cancelled documents never count,
 * drafts never count towards money.
 */

const POSTED = { $nin: ["CANCELLED", "DRAFT"] };

export interface Comparable {
  current: string;
  previous: string;
}

export interface PartyAging {
  partyId: string;
  name: string;
  phone?: string;
  total: string;
  b0_30: string;
  b31_60: string;
  b61_90: string;
  b90: string;
  invoices: number;
}

export interface AgingTable {
  rows: PartyAging[];
  /** Totals over every open document, not just the rows shown. */
  totals: Omit<PartyAging, "partyId" | "name" | "phone">;
  partyCount: number;
}

export interface Segment {
  key: string;
  label: string;
  customers: number;
  percent: string;
  value: string;
}

export interface ItemPerformance {
  itemId: string;
  name: string;
  bills: number;
  quantity: number;
  amount: string;
  /** Taxable value minus quantity × the item's current cost price; null when no cost is recorded. */
  margin: string | null;
}

export interface OverviewResult {
  period: { key: string; label: string; fromDate: string; toDate: string };
  previous: { fromDate: string; toDate: string };
  metrics: {
    sales: Comparable;
    salesCount: Comparable;
    soldQty: Comparable;
    salesReturns: Comparable;
    purchase: Comparable;
    purchaseCount: Comparable;
    purchaseReturns: Comparable | null;
    received: Comparable;
    paidOut: Comparable | null;
    avgInvoice: Comparable;
  };
  paymentModes: {
    sales: { mode: string; amount: string; count: number }[];
    receipts: { mode: string; amount: string; count: number }[];
  };
  aging: { receivable: AgingTable; payable: AgingTable | null };
  segments: { customers: number; items: Segment[] };
  categories: { name: string; value: string; percent: string }[];
  items: ItemPerformance[];
  generatedAt: string;
}

function range(from: Date, to: Date) {
  return { $gte: from, $lte: to };
}

async function docTotals(model: AnyModel, businessId: Types.ObjectId, from: Date, to: Date) {
  const [r] = await model.aggregate([
    { $match: { businessId, status: POSTED, documentDate: range(from, to) } },
    { $group: { _id: null, total: { $sum: "$totals.grandTotal" }, count: { $sum: 1 } } },
  ]);
  return { total: dec(r?.total), count: (r?.count as number) ?? 0 };
}

async function soldQuantity(businessId: Types.ObjectId, from: Date, to: Date): Promise<string> {
  const [r] = await SalesInvoice.aggregate([
    { $match: { businessId, status: POSTED, documentDate: range(from, to) } },
    { $unwind: "$lines" },
    { $group: { _id: null, qty: { $sum: "$lines.quantity" } } },
  ]);
  return String(r?.qty ?? 0);
}

async function cashTotal(businessId: Types.ObjectId, direction: "RECEIPT" | "PAYMENT", from: Date, to: Date) {
  const [r] = await Payment.aggregate([
    { $match: { businessId, direction, status: "CONFIRMED", documentDate: range(from, to) } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return dec(r?.total);
}

function cmp(current: string, previous: string): Comparable {
  return { current, previous };
}

/* ------------------------------------------------------------------ */

async function salesModes(businessId: Types.ObjectId, p: ResolvedPeriod) {
  const rows = await SalesInvoice.aggregate([
    { $match: { businessId, status: POSTED, documentDate: range(p.from, p.to) } },
    { $group: { _id: { $ifNull: ["$paymentMode", "CREDIT"] }, amount: { $sum: "$totals.grandTotal" }, count: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);
  return (rows as AnyDoc[]).map((r) => ({ mode: String(r._id), amount: dec(r.amount), count: r.count as number }));
}

async function receiptModes(businessId: Types.ObjectId, p: ResolvedPeriod) {
  const rows = await Payment.aggregate([
    { $match: { businessId, direction: "RECEIPT", status: "CONFIRMED", documentDate: range(p.from, p.to) } },
    { $group: { _id: "$mode", amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    { $sort: { amount: -1 } },
  ]);
  return (rows as AnyDoc[]).map((r) => ({ mode: String(r._id), amount: dec(r.amount), count: r.count as number }));
}

/**
 * Open balances per party, aged from the due date (or the document date when
 * no terms were set) as of today — the same rule as the dashboard's aging
 * chart, so the totals reconcile.
 */
async function partyAging(model: AnyModel, partyField: "customer" | "vendor", businessId: Types.ObjectId, now = new Date()): Promise<AgingTable> {
  const idField = partyField === "customer" ? "$customerId" : "$vendorId";
  const bucket = (min: number, max: number | null) => ({
    $sum: {
      $cond: [
        max === null
          ? { $gt: ["$__age", min - 1] }
          : { $and: [{ $gte: ["$__age", min] }, { $lte: ["$__age", max] }] },
        "$dueAmount",
        0,
      ],
    },
  });

  const rows = await model.aggregate([
    { $match: { businessId, status: POSTED, paymentStatus: { $ne: "PAID" }, dueAmount: { $gt: 0 } } },
    {
      $addFields: {
        __age: { $dateDiff: { startDate: { $ifNull: ["$dueDate", "$documentDate"] }, endDate: now, unit: "day" } },
      },
    },
    {
      $group: {
        _id: idField,
        name: { $first: `$${partyField}.name` },
        phone: { $first: `$${partyField}.phone` },
        total: { $sum: "$dueAmount" },
        // "<30" includes documents not yet due (negative age).
        b0_30: { $sum: { $cond: [{ $lte: ["$__age", 30] }, "$dueAmount", 0] } },
        b31_60: bucket(31, 60),
        b61_90: bucket(61, 90),
        b90: bucket(91, null),
        invoices: { $sum: 1 },
      },
    },
    { $sort: { total: -1 } },
  ]);

  const all = rows as AnyDoc[];
  const sum = (k: string) => all.reduce((a, r) => a.plus(String(r[k] ?? 0)), new Decimal(0)).toFixed(2);
  return {
    rows: all.slice(0, 25).map((r) => ({
      partyId: r._id?.toString() ?? "",
      name: r.name ?? "—",
      phone: r.phone || undefined,
      total: dec(r.total),
      b0_30: dec(r.b0_30),
      b31_60: dec(r.b31_60),
      b61_90: dec(r.b61_90),
      b90: dec(r.b90),
      invoices: r.invoices,
    })),
    totals: {
      total: sum("total"),
      b0_30: sum("b0_30"),
      b31_60: sum("b31_60"),
      b61_90: sum("b61_90"),
      b90: sum("b90"),
      invoices: all.reduce((a, r) => a + (r.invoices as number), 0),
    },
    partyCount: all.length,
  };
}

/** Tertile score 1–3 of `v` within `sorted` (ascending). */
function tertile(sorted: number[], v: number): 1 | 2 | 3 {
  if (sorted.length < 3) return 2;
  const lo = sorted[Math.floor(sorted.length / 3)];
  const hi = sorted[Math.floor((sorted.length * 2) / 3)];
  return v < lo ? 1 : v < hi ? 2 : 3;
}

const SEGMENTS: { key: string; label: string }[] = [
  { key: "cantLose", label: "Can't Lose" },
  { key: "loyal", label: "Loyal" },
  { key: "champions", label: "Champions" },
  { key: "atRisk", label: "At Risk" },
  { key: "potential", label: "Potential Loyalist" },
  { key: "hibernating", label: "Hibernating" },
  { key: "needsAttention", label: "Needs Attention" },
  { key: "promising", label: "Promising" },
];

/**
 * Recency / frequency / monetary segmentation of customers who bought in the
 * period. Each measure is scored 1–3 by tertile among those customers; the
 * frequency and monetary scores are averaged into one value axis.
 */
async function customerSegments(businessId: Types.ObjectId, p: ResolvedPeriod) {
  const rows = (await SalesInvoice.aggregate([
    { $match: { businessId, status: POSTED, documentDate: range(p.from, p.to) } },
    { $group: { _id: "$customerId", last: { $max: "$documentDate" }, count: { $sum: 1 }, value: { $sum: "$totals.grandTotal" } } },
  ])) as AnyDoc[];

  const data = rows.map((r) => ({
    recencyDays: Math.max(0, (p.to.getTime() - new Date(r.last).getTime()) / 86_400_000),
    count: r.count as number,
    value: Number(dec(r.value)),
  }));
  // Lower recency days = more recent = better, so score on the negated value.
  const rSorted = data.map((d) => -d.recencyDays).sort((a, b) => a - b);
  const fSorted = data.map((d) => d.count).sort((a, b) => a - b);
  const mSorted = data.map((d) => d.value).sort((a, b) => a - b);

  const tally: Record<string, { customers: number; value: number }> = {};
  for (const s of SEGMENTS) tally[s.key] = { customers: 0, value: 0 };

  for (const d of data) {
    const r = tertile(rSorted, -d.recencyDays);
    const fm = Math.round((tertile(fSorted, d.count) + tertile(mSorted, d.value)) / 2);
    const key =
      r === 1 ? (fm === 3 ? "cantLose" : fm === 2 ? "atRisk" : "hibernating")
      : r === 2 ? (fm >= 2 ? "loyal" : "needsAttention")
      : fm === 3 ? "champions" : fm === 2 ? "potential" : "promising";
    tally[key].customers += 1;
    tally[key].value += d.value;
  }

  const total = data.length;
  return {
    customers: total,
    items: SEGMENTS.map((s) => ({
      key: s.key,
      label: s.label,
      customers: tally[s.key].customers,
      percent: total ? ((tally[s.key].customers / total) * 100).toFixed(2) : "0.00",
      value: tally[s.key].value.toFixed(2),
    })),
  };
}

async function categoryMix(businessId: Types.ObjectId, p: ResolvedPeriod) {
  const rows = (await SalesInvoice.aggregate([
    { $match: { businessId, status: POSTED, documentDate: range(p.from, p.to) } },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.itemId", value: { $sum: "$lines.lineTotal" } } },
  ])) as AnyDoc[];
  if (rows.length === 0) return [];

  const items = await Item.find({ businessId, _id: { $in: rows.map((r) => r._id) } }, { categoryId: 1 }).lean<AnyDoc[]>();
  const catOf = new Map(items.map((i) => [i._id.toString(), i.categoryId?.toString() ?? ""]));
  const catIds = [...new Set([...catOf.values()].filter(Boolean))];
  const cats = await Category.find({ businessId, _id: { $in: catIds } }, { name: 1 }).lean<AnyDoc[]>();
  const nameOf = new Map(cats.map((c) => [c._id.toString(), c.name as string]));

  const byCat = new Map<string, Decimal>();
  for (const r of rows) {
    const name = nameOf.get(catOf.get(r._id?.toString()) ?? "") ?? "Uncategorised";
    byCat.set(name, (byCat.get(name) ?? new Decimal(0)).plus(dec(r.value)));
  }
  const total = [...byCat.values()].reduce((a, b) => a.plus(b), new Decimal(0));
  const sorted = [...byCat.entries()].sort((a, b) => b[1].comparedTo(a[1]));
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5).reduce((a, [, v]) => a.plus(v), new Decimal(0));
  if (rest.gt(0)) top.push(["Others", rest]);
  return top.map(([name, v]) => ({
    name,
    value: v.toFixed(2),
    percent: total.gt(0) ? v.div(total).times(100).toFixed(2) : "0.00",
  }));
}

async function itemPerformance(businessId: Types.ObjectId, p: ResolvedPeriod): Promise<ItemPerformance[]> {
  const rows = (await SalesInvoice.aggregate([
    { $match: { businessId, status: POSTED, documentDate: range(p.from, p.to) } },
    { $unwind: "$lines" },
    {
      $group: {
        _id: "$lines.itemId",
        name: { $first: "$lines.itemName" },
        quantity: { $sum: "$lines.quantity" },
        amount: { $sum: "$lines.lineTotal" },
        taxable: { $sum: "$lines.taxableAmount" },
        docs: { $addToSet: "$_id" },
      },
    },
    { $sort: { quantity: -1 } },
    { $limit: 500 },
  ])) as AnyDoc[];

  const items = await Item.find({ businessId, _id: { $in: rows.map((r) => r._id) } }, { costPrice: 1, purchasePrice: 1 }).lean<AnyDoc[]>();
  const costOf = new Map(
    items.map((i) => {
      const cost = new Decimal(dec(i.costPrice));
      return [i._id.toString(), cost.gt(0) ? cost : new Decimal(dec(i.purchasePrice))];
    })
  );

  return rows.map((r) => {
    const cost = costOf.get(r._id?.toString() ?? "");
    const margin = cost && cost.gt(0) ? new Decimal(dec(r.taxable)).minus(cost.times(r.quantity)).toFixed(2) : null;
    return {
      itemId: r._id?.toString() ?? "",
      name: r.name ?? "—",
      bills: r.docs?.length ?? 0,
      quantity: r.quantity,
      amount: dec(r.amount),
      margin,
    };
  });
}

/* ------------------------------------------------------------------ */

export async function runOverview(
  businessId: Types.ObjectId,
  query: AnalyticsQuery,
  access: { purchase: boolean }
): Promise<OverviewResult> {
  const p = resolvePeriod(query);
  const [c, pr] = [
    { from: p.from, to: p.to },
    { from: p.previousFrom, to: p.previousTo },
  ];

  const [
    salesNow, salesPrev, sretNow, sretPrev, qtyNow, qtyPrev, recNow, recPrev,
    purNow, purPrev, pretNow, pretPrev, payNow, payPrev,
    modesSales, modesReceipts, agingAR, agingAP, segments, categories, items,
  ] = await Promise.all([
    docTotals(SalesInvoice, businessId, c.from, c.to),
    docTotals(SalesInvoice, businessId, pr.from, pr.to),
    docTotals(SalesReturn, businessId, c.from, c.to),
    docTotals(SalesReturn, businessId, pr.from, pr.to),
    soldQuantity(businessId, c.from, c.to),
    soldQuantity(businessId, pr.from, pr.to),
    cashTotal(businessId, "RECEIPT", c.from, c.to),
    cashTotal(businessId, "RECEIPT", pr.from, pr.to),
    docTotals(PurchaseInvoice, businessId, c.from, c.to),
    docTotals(PurchaseInvoice, businessId, pr.from, pr.to),
    access.purchase ? docTotals(PurchaseReturn, businessId, c.from, c.to) : null,
    access.purchase ? docTotals(PurchaseReturn, businessId, pr.from, pr.to) : null,
    access.purchase ? cashTotal(businessId, "PAYMENT", c.from, c.to) : null,
    access.purchase ? cashTotal(businessId, "PAYMENT", pr.from, pr.to) : null,
    salesModes(businessId, p),
    receiptModes(businessId, p),
    partyAging(SalesInvoice, "customer", businessId),
    access.purchase ? partyAging(PurchaseInvoice, "vendor", businessId) : null,
    customerSegments(businessId, p),
    categoryMix(businessId, p),
    itemPerformance(businessId, p),
  ]);

  const avg = (t: { total: string; count: number }) =>
    t.count > 0 ? new Decimal(t.total).div(t.count).toFixed(2) : "0.00";

  return {
    period: { key: p.key, label: p.label, fromDate: p.from.toISOString(), toDate: p.to.toISOString() },
    previous: { fromDate: p.previousFrom.toISOString(), toDate: p.previousTo.toISOString() },
    metrics: {
      sales: cmp(salesNow.total, salesPrev.total),
      salesCount: cmp(String(salesNow.count), String(salesPrev.count)),
      soldQty: cmp(qtyNow, qtyPrev),
      salesReturns: cmp(sretNow.total, sretPrev.total),
      // Purchase totals are summary figures the dashboard KPIs already expose.
      purchase: cmp(purNow.total, purPrev.total),
      purchaseCount: cmp(String(purNow.count), String(purPrev.count)),
      purchaseReturns: pretNow && pretPrev ? cmp(pretNow.total, pretPrev.total) : null,
      received: cmp(recNow, recPrev),
      paidOut: payNow !== null && payPrev !== null ? cmp(payNow, payPrev) : null,
      avgInvoice: cmp(avg(salesNow), avg(salesPrev)),
    },
    paymentModes: { sales: modesSales, receipts: modesReceipts },
    aging: { receivable: agingAR, payable: agingAP },
    segments,
    categories,
    items,
    generatedAt: new Date().toISOString(),
  };
}

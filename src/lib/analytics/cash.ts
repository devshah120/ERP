import { Types } from "mongoose";
import Decimal from "decimal.js";
import { Payment } from "@/models/Payment";
import { Customer } from "@/models/Customer";
import { Vendor } from "@/models/Vendor";
import { SalesInvoice } from "@/models/salesDocuments";
import { PurchaseInvoice } from "@/models/purchaseDocuments";
import type { ResolvedPeriod } from "./period";
import { dec, dateRange, type RankedRow } from "./queries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

export interface CashSummary {
  count: number;
  total: string;
  allocated: string;
  /** Money taken in that has not been matched to an invoice yet. */
  onAccount: string;
  byMode: { mode: string; count: number; amount: string }[];
}

/** Money recorded through Receipts (in) or Payments (out) for the period. */
export async function cashSummary(
  businessId: Types.ObjectId,
  direction: "RECEIPT" | "PAYMENT",
  period: ResolvedPeriod
): Promise<CashSummary> {
  const match = {
    businessId,
    direction,
    status: "CONFIRMED",
    documentDate: dateRange(period),
  };

  const [totals, modes] = await Promise.all([
    Payment.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          total: { $sum: "$amount" },
          allocated: { $sum: "$allocatedAmount" },
          onAccount: { $sum: "$unallocatedAmount" },
        },
      },
    ]),
    Payment.aggregate([
      { $match: match },
      { $group: { _id: "$mode", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
      { $sort: { amount: -1 } },
    ]),
  ]);

  const t = (totals as AnyDoc[])[0] ?? {};
  return {
    count: t.count ?? 0,
    total: dec(t.total),
    allocated: dec(t.allocated),
    onAccount: dec(t.onAccount),
    byMode: (modes as AnyDoc[]).map((m) => ({
      mode: m._id ?? "—",
      count: m.count,
      amount: dec(m.amount),
    })),
  };
}

export interface PartySummary {
  total: number;
  active: number;
  newInPeriod: number;
  /** Parties carrying a balance right now, and what it adds up to. */
  withOutstanding: number;
  outstandingAmount: string;
}

/**
 * Customer/vendor health.
 *
 * "Active" means transacted inside the selected period — a definition the
 * UI states out loud, because an inactivity count is meaningless without
 * knowing the window it was measured over.
 */
export async function partySummary(
  businessId: Types.ObjectId,
  kind: "customer" | "vendor",
  period: ResolvedPeriod
): Promise<PartySummary> {
  const master = kind === "customer" ? Customer : Vendor;
  const invoice = kind === "customer" ? SalesInvoice : PurchaseInvoice;
  const idField = kind === "customer" ? "$customerId" : "$vendorId";

  const [total, newInPeriod, activeRows, outstandingRows] = await Promise.all([
    master.countDocuments({ businessId, status: { $ne: "DELETED" } }),
    master.countDocuments({ businessId, createdAt: dateRange(period) }),
    invoice.aggregate([
      {
        $match: {
          businessId,
          status: { $nin: ["CANCELLED", "DRAFT"] },
          documentDate: dateRange(period),
        },
      },
      { $group: { _id: idField } },
      { $count: "n" },
    ]),
    invoice.aggregate([
      {
        $match: {
          businessId,
          status: { $nin: ["CANCELLED", "DRAFT"] },
          paymentStatus: { $ne: "PAID" },
        },
      },
      { $group: { _id: idField, due: { $sum: "$dueAmount" } } },
      { $match: { due: { $gt: 0 } } },
      { $group: { _id: null, parties: { $sum: 1 }, due: { $sum: "$due" } } },
    ]),
  ]);

  const o = (outstandingRows as AnyDoc[])[0] ?? {};
  return {
    total,
    active: (activeRows as AnyDoc[])[0]?.n ?? 0,
    newInPeriod,
    withOutstanding: o.parties ?? 0,
    outstandingAmount: dec(o.due),
  };
}

/** Parties owing (or owed) the most right now, regardless of period. */
export async function topOutstandingParties(
  businessId: Types.ObjectId,
  kind: "customer" | "vendor",
  limit = 5
): Promise<RankedRow[]> {
  const invoice = kind === "customer" ? SalesInvoice : PurchaseInvoice;
  const idField = kind === "customer" ? "$customerId" : "$vendorId";
  const nameField = kind === "customer" ? "$customer.name" : "$vendor.name";

  const rows = await invoice.aggregate([
    {
      $match: {
        businessId,
        status: { $nin: ["CANCELLED", "DRAFT"] },
        paymentStatus: { $ne: "PAID" },
      },
    },
    { $group: { _id: idField, name: { $first: nameField }, count: { $sum: 1 }, due: { $sum: "$dueAmount" } } },
    { $match: { due: { $gt: 0 } } },
    { $sort: { due: -1 } },
    { $limit: limit },
  ]);

  return (rows as AnyDoc[]).map((r) => ({
    id: r._id?.toString() ?? "",
    name: r.name ?? "—",
    count: r.count,
    value: dec(r.due),
  }));
}

/** Net position: what is owed to you minus what you owe. */
export function netPosition(receivable: string, payable: string): string {
  return new Decimal(receivable).minus(payable).toFixed(2);
}

import { Types } from "mongoose";
import Decimal from "decimal.js";
import { Account, NORMAL_BALANCE, type AccountType } from "@/models/Account";
import { Voucher } from "@/models/Voucher";
import { User } from "@/models/User";
import { BankAccount, SalesTarget } from "@/models/setupMasters";
import { SalesInvoice } from "@/models/salesDocuments";
import { PurchaseInvoice } from "@/models/purchaseDocuments";
import { Payment } from "@/models/Payment";
import { Item } from "@/models/Item";
import { PosOrder } from "@/models/pos";
import { dateFilter } from "./helpers";
import type { ReportContext, ReportQuery, ReportRunResult } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const dec = (v: unknown) => new Decimal(String(v ?? 0));
const ZERO = new Decimal(0);

function page<T>(rows: T[], query: ReportQuery): T[] {
  const start = (query.page - 1) * query.pageSize;
  return rows.slice(start, start + query.pageSize);
}

/**
 * The accounts that hold money: Cash in Hand, Bank Accounts, and any ledger a
 * Bank Account master points at. Cash-flow reporting is movement on these.
 */
export async function moneyAccounts(businessId: Types.ObjectId) {
  const [system, banks] = await Promise.all([
    Account.find({ businessId, systemRole: { $in: ["CASH", "BANK"] }, deletedAt: null }).lean<AnyDoc[]>(),
    BankAccount.find({ businessId, deletedAt: null, ledgerAccountId: { $ne: null } }, { ledgerAccountId: 1 }).lean<AnyDoc[]>(),
  ]);
  const extraIds = banks.map((b) => b.ledgerAccountId).filter(Boolean);
  const extra = extraIds.length
    ? await Account.find({ businessId, _id: { $in: extraIds }, deletedAt: null }).lean<AnyDoc[]>()
    : [];
  const byId = new Map<string, AnyDoc>();
  for (const a of [...system, ...extra]) byId.set(a._id.toString(), a);
  return [...byId.values()];
}

/** Opening balance of a set of debit-natured accounts before a date. */
async function openingFor(businessId: Types.ObjectId, accounts: AnyDoc[], before?: Date): Promise<Decimal> {
  let opening = ZERO;
  for (const a of accounts) {
    const seeded = dec(a.openingBalance);
    opening = opening.plus(a.openingBalanceType === NORMAL_BALANCE[a.type as AccountType] ? seeded : seeded.negated());
  }
  if (!before) return opening;
  const ids = accounts.map((a) => a._id);
  const agg = await Voucher.aggregate([
    { $match: { businessId, status: "POSTED", voucherDate: { $lt: before }, "lines.accountId": { $in: ids } } },
    { $unwind: "$lines" },
    { $match: { "lines.accountId": { $in: ids } } },
    { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]);
  const row = (agg as AnyDoc[])[0];
  return row ? opening.plus(dec(row.debit)).minus(dec(row.credit)) : opening;
}

interface MoneyLine {
  voucher: AnyDoc;
  line: AnyDoc;
  account: AnyDoc;
  inflow: Decimal;
  outflow: Decimal;
}

/** Every posted voucher line on a money account within the window, oldest first. */
async function moneyLines(ctx: ReportContext, query: ReportQuery, accounts: AnyDoc[]) {
  const ids = accounts.map((a) => a._id);
  const byId = new Map(accounts.map((a) => [a._id.toString(), a]));
  const match: Record<string, unknown> = { businessId: ctx.businessId, status: "POSTED", "lines.accountId": { $in: ids } };
  const range = dateFilter(query);
  if (range) match.voucherDate = range;
  const vouchers = await Voucher.find(match).sort({ voucherDate: 1, createdAt: 1 }).lean<AnyDoc[]>();

  const out: MoneyLine[] = [];
  for (const v of vouchers) {
    for (const line of v.lines as AnyDoc[]) {
      const account = byId.get(line.accountId.toString());
      if (!account) continue;
      out.push({ voucher: v, line, account, inflow: dec(line.debit), outflow: dec(line.credit) });
    }
  }
  return { lines: out, range };
}

/** "Sales, Output CGST" — the other side of the entry, which is what a cash book reader wants. */
function particulars(v: AnyDoc, excludeIds: Set<string>) {
  return (
    (v.lines as AnyDoc[])
      .filter((l) => !excludeIds.has(l.accountId.toString()))
      .map((l) => l.accountName)
      .filter((n, i, all) => all.indexOf(n) === i)
      .join(", ") || "Transfer between cash/bank"
  );
}

/* ================================================================== */
/* Bank transactions                                                   */
/* ================================================================== */

export async function bankTransactions(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  let accounts = await moneyAccounts(ctx.businessId);
  if (query.accountId && Types.ObjectId.isValid(query.accountId)) {
    accounts = accounts.filter((a) => a._id.toString() === query.accountId);
  }
  if (accounts.length === 0) {
    return { rows: [], total: 0, summary: [{ label: "No cash or bank accounts", value: "Set up the chart of accounts" }] };
  }
  const moneyIds = new Set(accounts.map((a) => a._id.toString()));
  const { lines, range } = await moneyLines(ctx, query, accounts);
  const opening = await openingFor(ctx.businessId, accounts, range?.$gte);

  let running = opening;
  let totalIn = ZERO;
  let totalOut = ZERO;
  const rows = lines.map(({ voucher: v, line, account, inflow, outflow }) => {
    running = running.plus(inflow).minus(outflow);
    totalIn = totalIn.plus(inflow);
    totalOut = totalOut.plus(outflow);
    return {
      date: v.voucherDate?.toISOString(),
      voucherNumber: v.voucherNumber,
      voucherNumberHref: `/account-vouchers/${v._id.toString()}`,
      account: account.name,
      particulars: particulars(v, moneyIds),
      reference: v.sourceNumber ?? v.referenceNumber ?? "—",
      narration: line.narration ?? v.narration ?? "—",
      moneyIn: inflow.toFixed(2),
      moneyOut: outflow.toFixed(2),
      balance: running.toFixed(2),
    };
  });

  return {
    total: rows.length,
    summary: [
      { label: "Opening balance", value: opening.toFixed(2) },
      { label: "Money in", value: totalIn.toFixed(2) },
      { label: "Money out", value: totalOut.toFixed(2) },
      { label: "Closing balance", value: running.toFixed(2) },
    ],
    // Newest first on screen; the running balance was computed oldest-first.
    rows: page(rows.reverse(), query),
  };
}

/* ================================================================== */
/* Cash flow                                                           */
/* ================================================================== */

/**
 * Money in and out of cash and bank, period by period — by day for a window
 * of a month or less, by month otherwise. Transfers between two money
 * accounts (cash deposited in the bank) are excluded: they move money, but
 * none comes in or goes out.
 */
export async function cashFlow(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const accounts = await moneyAccounts(ctx.businessId);
  if (accounts.length === 0) {
    return { rows: [], total: 0, summary: [{ label: "No cash or bank accounts", value: "Set up the chart of accounts" }] };
  }
  const moneyIds = new Set(accounts.map((a) => a._id.toString()));
  const { lines, range } = await moneyLines(ctx, query, accounts);
  const opening = await openingFor(ctx.businessId, accounts, range?.$gte);

  const from = range?.$gte ?? lines[0]?.voucher.voucherDate;
  const to = range?.$lte ?? new Date();
  const daily = from && to.getTime() - new Date(from).getTime() <= 31 * 86_400_000;

  const buckets = new Map<string, { label: string; inflow: Decimal; outflow: Decimal; byCounterpart: Map<string, Decimal> }>();
  const counterpartTotals = new Map<string, { inflow: Decimal; outflow: Decimal }>();

  for (const { voucher: v, inflow, outflow } of lines) {
    const others = (v.lines as AnyDoc[]).filter((l) => !moneyIds.has(l.accountId.toString()));
    if (others.length === 0) continue; // a transfer between money accounts

    const d = new Date(v.voucherDate);
    const key = daily ? d.toISOString().slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = daily
      ? d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
      : d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    const b = buckets.get(key) ?? { label, inflow: ZERO, outflow: ZERO, byCounterpart: new Map() };
    b.inflow = b.inflow.plus(inflow);
    b.outflow = b.outflow.plus(outflow);
    buckets.set(key, b);

    const cp = others[0].accountName as string;
    const c = counterpartTotals.get(cp) ?? { inflow: ZERO, outflow: ZERO };
    c.inflow = c.inflow.plus(inflow);
    c.outflow = c.outflow.plus(outflow);
    counterpartTotals.set(cp, c);
  }

  let running = opening;
  let totalIn = ZERO;
  let totalOut = ZERO;
  const rows = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, b]) => {
      const openingBal = running;
      running = running.plus(b.inflow).minus(b.outflow);
      totalIn = totalIn.plus(b.inflow);
      totalOut = totalOut.plus(b.outflow);
      return {
        period: b.label,
        opening: openingBal.toFixed(2),
        inflow: b.inflow.toFixed(2),
        outflow: b.outflow.toFixed(2),
        net: b.inflow.minus(b.outflow).toFixed(2),
        closing: running.toFixed(2),
      };
    });

  const topIn = [...counterpartTotals.entries()].sort((a, b) => b[1].inflow.comparedTo(a[1].inflow))[0];
  const topOut = [...counterpartTotals.entries()].sort((a, b) => b[1].outflow.comparedTo(a[1].outflow))[0];

  return {
    total: rows.length,
    summary: [
      { label: "Opening balance", value: opening.toFixed(2) },
      { label: "Money in", value: totalIn.toFixed(2) },
      { label: "Money out", value: totalOut.toFixed(2) },
      { label: "Net cash flow", value: totalIn.minus(totalOut).toFixed(2) },
      { label: "Closing balance", value: running.toFixed(2) },
      ...(topIn && topIn[1].inflow.gt(0) ? [{ label: `Largest source: ${topIn[0]}`, value: topIn[1].inflow.toFixed(2) }] : []),
      ...(topOut && topOut[1].outflow.gt(0) ? [{ label: `Largest use: ${topOut[0]}`, value: topOut[1].outflow.toFixed(2) }] : []),
    ],
    rows: page(rows, query),
  };
}

/* ================================================================== */
/* Owner cash flow                                                     */
/* ================================================================== */

/**
 * Money between the business and its owners: capital brought in (cash or
 * bank debited, an equity account credited) and drawings taken out (the
 * reverse). Opening-balance equity is a bookkeeping device, not the owner's
 * money, so it is left out.
 */
export async function ownerCashFlow(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const [money, equity] = await Promise.all([
    moneyAccounts(ctx.businessId),
    Account.find({
      businessId: ctx.businessId,
      type: "EQUITY",
      isGroup: false,
      deletedAt: null,
      systemRole: { $ne: "OPENING_BALANCE_EQUITY" },
    }).lean<AnyDoc[]>(),
  ]);
  const moneyIds = new Set(money.map((a) => a._id.toString()));
  const equityIds = equity.map((a) => a._id);
  if (equityIds.length === 0 || moneyIds.size === 0) {
    return { rows: [], total: 0, summary: [{ label: "No equity or cash accounts", value: "Set up the chart of accounts" }] };
  }

  const match: Record<string, unknown> = { businessId: ctx.businessId, status: "POSTED", "lines.accountId": { $in: equityIds } };
  const range = dateFilter(query);
  if (range) match.voucherDate = range;
  const vouchers = await Voucher.find(match).sort({ voucherDate: -1 }).lean<AnyDoc[]>();
  const equitySet = new Set(equityIds.map(String));

  let introduced = ZERO;
  let drawn = ZERO;
  const rows: Record<string, unknown>[] = [];
  for (const v of vouchers) {
    if (!(v.lines as AnyDoc[]).some((l) => moneyIds.has(l.accountId.toString()))) continue;
    for (const l of v.lines as AnyDoc[]) {
      if (!equitySet.has(l.accountId.toString())) continue;
      const capital = dec(l.credit);
      const drawing = dec(l.debit);
      introduced = introduced.plus(capital);
      drawn = drawn.plus(drawing);
      rows.push({
        date: v.voucherDate?.toISOString(),
        voucherNumber: v.voucherNumber,
        voucherNumberHref: `/account-vouchers/${v._id.toString()}`,
        account: l.accountName,
        via: (v.lines as AnyDoc[]).filter((x) => moneyIds.has(x.accountId.toString())).map((x) => x.accountName).join(", "),
        narration: l.narration ?? v.narration ?? "—",
        capitalIn: capital.toFixed(2),
        drawings: drawing.toFixed(2),
      });
    }
  }

  return {
    total: rows.length,
    summary: [
      { label: "Capital introduced", value: introduced.toFixed(2) },
      { label: "Drawings", value: drawn.toFixed(2) },
      { label: introduced.gte(drawn) ? "Net put in by owners" : "Net taken out by owners", value: introduced.minus(drawn).abs().toFixed(2) },
    ],
    rows: page(rows, query),
  };
}

/* ================================================================== */
/* Manager cash flow                                                   */
/* ================================================================== */

/**
 * Cash and bank movement grouped by the person who recorded it — who
 * collected what, who paid out what. For auto-posted entries that is the
 * user who completed the source document (the invoice, the POS sale).
 */
export async function managerCashFlow(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const accounts = await moneyAccounts(ctx.businessId);
  if (accounts.length === 0) {
    return { rows: [], total: 0, summary: [{ label: "No cash or bank accounts", value: "Set up the chart of accounts" }] };
  }
  const moneyIds = new Set(accounts.map((a) => a._id.toString()));
  const cashIds = new Set(accounts.filter((a) => a.systemRole === "CASH").map((a) => a._id.toString()));
  const { lines } = await moneyLines(ctx, query, accounts);

  const byUser = new Map<string, { entries: Set<string>; cashIn: Decimal; cashOut: Decimal; bankIn: Decimal; bankOut: Decimal; last: Date }>();
  for (const { voucher: v, line, inflow, outflow } of lines) {
    if ((v.lines as AnyDoc[]).every((l) => moneyIds.has(l.accountId.toString()))) continue;
    const key = v.createdBy?.toString() ?? "system";
    const u = byUser.get(key) ?? { entries: new Set(), cashIn: ZERO, cashOut: ZERO, bankIn: ZERO, bankOut: ZERO, last: v.voucherDate };
    u.entries.add(v._id.toString());
    if (cashIds.has(line.accountId.toString())) {
      u.cashIn = u.cashIn.plus(inflow);
      u.cashOut = u.cashOut.plus(outflow);
    } else {
      u.bankIn = u.bankIn.plus(inflow);
      u.bankOut = u.bankOut.plus(outflow);
    }
    if (v.voucherDate > u.last) u.last = v.voucherDate;
    byUser.set(key, u);
  }

  const ids = [...byUser.keys()].filter((k) => Types.ObjectId.isValid(k));
  const users = await User.find({ businessId: ctx.businessId, _id: { $in: ids } }, { name: 1, username: 1 }).lean<AnyDoc[]>();
  const nameOf = new Map(users.map((u) => [u._id.toString(), `${u.name} (@${u.username})`]));

  let totalCashNet = ZERO;
  const rows = [...byUser.entries()]
    .map(([key, u]) => {
      totalCashNet = totalCashNet.plus(u.cashIn).minus(u.cashOut);
      return {
        person: key === "system" ? "System" : nameOf.get(key) ?? "Former user",
        entries: u.entries.size,
        cashIn: u.cashIn.toFixed(2),
        cashOut: u.cashOut.toFixed(2),
        cashNet: u.cashIn.minus(u.cashOut).toFixed(2),
        bankIn: u.bankIn.toFixed(2),
        bankOut: u.bankOut.toFixed(2),
        lastEntry: u.last?.toISOString(),
      };
    })
    .sort((a, b) => dec(b.cashIn).comparedTo(dec(a.cashIn)));

  return {
    total: rows.length,
    summary: [
      { label: "People handling money", value: String(rows.filter((r) => r.person !== "System").length) },
      { label: "Net cash held across people", value: totalCashNet.toFixed(2) },
    ],
    rows: page(rows, query),
  };
}

/* ================================================================== */
/* Target vs actual                                                    */
/* ================================================================== */

const POSTED_INVOICE = { $in: ["POSTED", "PARTIALLY_PAID", "PAID"] };

async function actualFor(businessId: Types.ObjectId, t: AnyDoc): Promise<Decimal> {
  const period = { $gte: t.periodFrom, $lte: new Date(new Date(t.periodTo).setHours(23, 59, 59, 999)) };

  if (t.metric === "COLLECTION_AMOUNT") {
    const [receipts, pos] = await Promise.all([
      Payment.aggregate([
        { $match: { businessId, direction: "RECEIPT", status: "CONFIRMED", documentDate: period } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      PosOrder.aggregate([
        { $match: { businessId, status: "COMPLETED", orderDate: period } },
        { $group: { _id: null, total: { $sum: "$totals.grandTotal" } } },
      ]),
    ]);
    return dec((receipts as AnyDoc[])[0]?.total).plus(dec((pos as AnyDoc[])[0]?.total));
  }

  if (t.metric === "PURCHASE_AMOUNT") {
    const agg = await PurchaseInvoice.aggregate([
      { $match: { businessId, status: POSTED_INVOICE, documentDate: period } },
      { $group: { _id: null, total: { $sum: "$totals.taxableAmount" } } },
    ]);
    return dec((agg as AnyDoc[])[0]?.total);
  }

  // Sales value or quantity, optionally narrowed to an agent and/or category.
  const qty = t.metric === "SALES_QUANTITY";
  const itemIds = t.categoryId ? (await Item.find({ businessId, categoryId: t.categoryId }, { _id: 1 }).lean<AnyDoc[]>()).map((i) => i._id) : null;
  const lineMatch = itemIds ? [{ $match: { "lines.itemId": { $in: itemIds } } }] : [];
  const sumField = qty ? "$lines.quantity" : "$lines.taxableAmount";

  const invoiceMatch: Record<string, unknown> = { businessId, status: POSTED_INVOICE, documentDate: period };
  if (t.agentId) invoiceMatch.agentId = t.agentId;
  const invoices = await SalesInvoice.aggregate([
    { $match: invoiceMatch },
    { $unwind: "$lines" },
    ...lineMatch,
    { $group: { _id: null, total: { $sum: sumField } } },
  ]);
  let total = dec((invoices as AnyDoc[])[0]?.total);

  // Counter sales carry no agent, so they only count toward unscoped targets.
  if (!t.agentId) {
    const pos = await PosOrder.aggregate([
      { $match: { businessId, status: "COMPLETED", orderDate: period } },
      { $unwind: "$lines" },
      ...lineMatch,
      { $group: { _id: null, total: { $sum: sumField } } },
    ]);
    total = total.plus(dec((pos as AnyDoc[])[0]?.total));
  }
  return total;
}

const METRIC_LABEL: Record<string, string> = {
  SALES_AMOUNT: "Sales value",
  SALES_QUANTITY: "Sales quantity",
  COLLECTION_AMOUNT: "Collections",
  PURCHASE_AMOUNT: "Purchase value",
};

/**
 * Each active target against what actually happened in its period. "Pace"
 * compares achievement with how much of the period has elapsed, so a target
 * 40% done with 30% of the month gone reads as ahead, not behind.
 */
export async function targetVsActual(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null, status: "ACTIVE" };
  if (query.fromDate) filter.periodTo = { $gte: new Date(query.fromDate) };
  if (query.toDate) filter.periodFrom = { $lte: new Date(`${query.toDate}T23:59:59`) };
  const targets = await SalesTarget.find(filter).sort({ periodFrom: -1 }).lean<AnyDoc[]>();

  const now = Date.now();
  let achieved = 0;
  const rows = [];
  for (const t of targets) {
    const actual = await actualFor(ctx.businessId, t);
    const target = dec(t.targetValue);
    const pct = target.gt(0) ? actual.div(target).times(100) : ZERO;
    const start = new Date(t.periodFrom).getTime();
    const end = new Date(t.periodTo).getTime() + 86_399_999;
    const elapsed = Math.min(1, Math.max(0, (now - start) / Math.max(1, end - start)));
    const status = pct.gte(100)
      ? "ACHIEVED"
      : now > end
        ? "MISSED"
        : now < start
          ? "NOT_STARTED"
          : pct.div(100).gte(elapsed)
            ? "ON_TRACK"
            : "BEHIND";
    if (status === "ACHIEVED") achieved += 1;
    rows.push({
      name: t.name,
      nameHref: `/targets/${t._id.toString()}`,
      metric: METRIC_LABEL[t.metric] ?? t.metric,
      periodFrom: new Date(t.periodFrom).toISOString(),
      periodTo: new Date(t.periodTo).toISOString(),
      target: target.toFixed(2),
      actual: actual.toFixed(2),
      achievement: pct.toFixed(1),
      remaining: Decimal.max(ZERO, target.minus(actual)).toFixed(2),
      elapsed: (elapsed * 100).toFixed(0),
      status,
    });
  }

  return {
    total: rows.length,
    summary: [
      { label: "Targets", value: String(rows.length) },
      { label: "Achieved", value: String(achieved) },
      { label: "Behind pace", value: String(rows.filter((r) => r.status === "BEHIND").length) },
    ],
    rows: page(rows, query),
  };
}

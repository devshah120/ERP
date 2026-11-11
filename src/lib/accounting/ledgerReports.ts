import { Types } from "mongoose";
import Decimal from "decimal.js";
import { Account, NORMAL_BALANCE, type AccountType } from "@/models/Account";
import { Voucher } from "@/models/Voucher";
import type { ReportContext, ReportQuery, ReportRunResult } from "@/lib/reports/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const dec = (v: unknown) => new Decimal(String(v ?? 0));

/** Only posted vouchers move the ledger; cancelled ones are history. */
const POSTED = { status: "POSTED" as const };

function dateRange(query: ReportQuery) {
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

/**
 * Signed balance for an account, in its own natural direction.
 *
 * An asset with more debits than credits has a positive balance; so does a
 * liability with more credits than debits. Without this the trial balance
 * would show half the business as negative.
 */
function naturalBalance(type: AccountType, debit: Decimal, credit: Decimal): Decimal {
  return NORMAL_BALANCE[type] === "DEBIT" ? debit.minus(credit) : credit.minus(debit);
}

/** Movement per account over a window, from the voucher lines. */
async function movementsByAccount(
  businessId: Types.ObjectId,
  range?: Record<string, Date>
): Promise<Map<string, { debit: Decimal; credit: Decimal }>> {
  const match: Record<string, unknown> = { businessId, ...POSTED };
  if (range) match.voucherDate = range;

  const rows = await Voucher.aggregate([
    { $match: match },
    { $unwind: "$lines" },
    {
      $group: {
        _id: "$lines.accountId",
        debit: { $sum: "$lines.debit" },
        credit: { $sum: "$lines.credit" },
      },
    },
  ]);

  return new Map(
    (rows as AnyDoc[]).map((r) => [r._id.toString(), { debit: dec(r.debit), credit: dec(r.credit) }])
  );
}

/* ================================================================== */
/* Trial balance                                                       */
/* ================================================================== */

/**
 * Every posting account with its opening balance, period movement and
 * closing balance.
 *
 * Group headings are excluded: they hold no postings, and including them
 * would double-count their children in the totals.
 */
export async function trialBalance(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const range = dateRange(query);
  const accounts = await Account.find({
    businessId: ctx.businessId,
    isGroup: false,
    deletedAt: null,
  })
    .sort({ code: 1 })
    .lean<AnyDoc[]>();

  const [movement, opening] = await Promise.all([
    movementsByAccount(ctx.businessId, range),
    // Anything before the window start is opening balance for this report.
    range?.$gte
      ? movementsByAccount(ctx.businessId, { $lt: range.$gte })
      : Promise.resolve(new Map<string, { debit: Decimal; credit: Decimal }>()),
  ]);

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  let totalOpening = new Decimal(0);
  let totalClosing = new Decimal(0);

  const rows = accounts
    .map((a) => {
      const id = a._id.toString();
      const move = movement.get(id) ?? { debit: new Decimal(0), credit: new Decimal(0) };
      const before = opening.get(id) ?? { debit: new Decimal(0), credit: new Decimal(0) };

      // The account's own opening balance, plus anything posted before the window.
      const seeded = dec(a.openingBalance);
      const seededSigned = a.openingBalanceType === NORMAL_BALANCE[a.type as AccountType] ? seeded : seeded.negated();
      const openingBalance = seededSigned.plus(naturalBalance(a.type, before.debit, before.credit));
      const periodBalance = naturalBalance(a.type, move.debit, move.credit);
      const closing = openingBalance.plus(periodBalance);

      totalDebit = totalDebit.plus(move.debit);
      totalCredit = totalCredit.plus(move.credit);
      totalOpening = totalOpening.plus(openingBalance);
      totalClosing = totalClosing.plus(closing);

      return {
        code: a.code,
        name: a.name,
        nameHref: `/account-vouchers?accountId=${id}`,
        type: a.type,
        normalBalance: NORMAL_BALANCE[a.type as AccountType],
        openingBalance: openingBalance.toFixed(2),
        debit: move.debit.toFixed(2),
        credit: move.credit.toFixed(2),
        closingBalance: closing.toFixed(2),
        hasActivity: move.debit.gt(0) || move.credit.gt(0) || !openingBalance.eq(0),
      };
    })
    // An account nobody has posted to is noise on a trial balance.
    .filter((r) => r.hasActivity);

  const difference = totalDebit.minus(totalCredit);
  const start = (query.page - 1) * query.pageSize;

  return {
    total: rows.length,
    summary: [
      { label: "Accounts with activity", value: String(rows.length) },
      { label: "Total debits", value: totalDebit.toFixed(2) },
      { label: "Total credits", value: totalCredit.toFixed(2) },
      // If this is ever non-zero, something posted an unbalanced voucher and
      // the figure is the alarm, not a rounding note.
      { label: "Difference", value: difference.toFixed(2) },
    ],
    rows: rows.slice(start, start + query.pageSize),
  };
}

/* ================================================================== */
/* General ledger                                                      */
/* ================================================================== */

/**
 * Every posting against one account, in date order, with a running balance.
 *
 * Requires an account to be chosen — a "general ledger" of every account at
 * once is just the voucher list, and the running balance would be meaningless
 * across different accounts.
 */
export async function generalLedger(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const accountId = query.accountId;
  if (!accountId || !Types.ObjectId.isValid(accountId)) {
    return {
      total: 0,
      rows: [],
      summary: [{ label: "Select an account", value: "—" }],
    };
  }

  const account = await Account.findOne({
    businessId: ctx.businessId,
    _id: new Types.ObjectId(accountId),
  }).lean<AnyDoc>();
  if (!account) {
    return { total: 0, rows: [], summary: [{ label: "Account not found", value: "—" }] };
  }

  const range = dateRange(query);
  const match: Record<string, unknown> = {
    businessId: ctx.businessId,
    ...POSTED,
    "lines.accountId": new Types.ObjectId(accountId),
  };
  if (range) match.voucherDate = range;

  const vouchers = await Voucher.find(match).sort({ voucherDate: 1, createdAt: 1 }).lean<AnyDoc[]>();

  // Opening balance: the account's own, plus everything posted before the window.
  const seeded = dec(account.openingBalance);
  const seededSigned =
    account.openingBalanceType === NORMAL_BALANCE[account.type as AccountType] ? seeded : seeded.negated();

  let opening = seededSigned;
  if (range?.$gte) {
    const before = await Voucher.aggregate([
      {
        $match: {
          businessId: ctx.businessId,
          ...POSTED,
          voucherDate: { $lt: range.$gte },
          "lines.accountId": new Types.ObjectId(accountId),
        },
      },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": new Types.ObjectId(accountId) } },
      { $group: { _id: null, debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
    ]);
    const b = (before as AnyDoc[])[0];
    if (b) opening = opening.plus(naturalBalance(account.type, dec(b.debit), dec(b.credit)));
  }

  let running = opening;
  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const rows: Record<string, unknown>[] = [];

  for (const v of vouchers) {
    // A voucher can touch the same account more than once; each line is its
    // own ledger row so the running balance stays traceable.
    for (const line of v.lines as AnyDoc[]) {
      if (line.accountId.toString() !== accountId) continue;

      const debit = dec(line.debit);
      const credit = dec(line.credit);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      running = running.plus(naturalBalance(account.type, debit, credit));

      rows.push({
        voucherDate: v.voucherDate?.toISOString(),
        voucherNumber: v.voucherNumber,
        voucherNumberHref: `/account-vouchers/${v._id.toString()}`,
        voucherType: v.voucherType,
        particulars:
          // What the other side of the entry was — the useful column on a
          // ledger, rather than repeating the account you are looking at.
          (v.lines as AnyDoc[])
            .filter((l) => l.accountId.toString() !== accountId)
            .map((l) => l.accountName)
            .join(", ") || "—",
        reference: v.sourceNumber ?? v.referenceNumber ?? "—",
        narration: line.narration ?? v.narration ?? "—",
        debit: debit.toFixed(2),
        credit: credit.toFixed(2),
        balance: running.toFixed(2),
      });
    }
  }

  const start = (query.page - 1) * query.pageSize;

  return {
    total: rows.length,
    summary: [
      { label: `${account.code} · ${account.name}`, value: account.type },
      { label: "Opening balance", value: opening.toFixed(2) },
      { label: "Debits", value: totalDebit.toFixed(2) },
      { label: "Credits", value: totalCredit.toFixed(2) },
      { label: "Closing balance", value: running.toFixed(2) },
    ],
    rows: rows.slice(start, start + query.pageSize),
  };
}

/* ================================================================== */
/* Profit & loss                                                       */
/* ================================================================== */

/** Income less expenses for the period, from the ledger rather than from
 *  invoice totals — so credit notes and journal adjustments are included. */
export async function profitAndLoss(ctx: ReportContext, query: ReportQuery): Promise<ReportRunResult> {
  const range = dateRange(query);
  const [accounts, movement] = await Promise.all([
    Account.find({
      businessId: ctx.businessId,
      isGroup: false,
      deletedAt: null,
      type: { $in: ["INCOME", "EXPENSE"] },
    })
      .sort({ type: 1, code: 1 })
      .lean<AnyDoc[]>(),
    movementsByAccount(ctx.businessId, range),
  ]);

  let totalIncome = new Decimal(0);
  let totalExpense = new Decimal(0);

  const rows = accounts
    .map((a) => {
      const move = movement.get(a._id.toString()) ?? { debit: new Decimal(0), credit: new Decimal(0) };
      const amount = naturalBalance(a.type, move.debit, move.credit);
      if (a.type === "INCOME") totalIncome = totalIncome.plus(amount);
      else totalExpense = totalExpense.plus(amount);

      return {
        code: a.code,
        name: a.name,
        nameHref: `/general-ledger?accountId=${a._id.toString()}`,
        section: a.type === "INCOME" ? "Income" : "Expense",
        amount: amount.toFixed(2),
        hasActivity: !amount.eq(0),
      };
    })
    .filter((r) => r.hasActivity);

  const net = totalIncome.minus(totalExpense);
  const start = (query.page - 1) * query.pageSize;

  return {
    total: rows.length,
    summary: [
      { label: "Total income", value: totalIncome.toFixed(2) },
      { label: "Total expenses", value: totalExpense.toFixed(2) },
      { label: net.gte(0) ? "Net profit" : "Net loss", value: net.abs().toFixed(2) },
    ],
    rows: rows.slice(start, start + query.pageSize),
  };
}

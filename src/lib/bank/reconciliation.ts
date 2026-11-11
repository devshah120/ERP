import { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Account, NORMAL_BALANCE, type AccountType } from "@/models/Account";
import { Voucher } from "@/models/Voucher";
import { BankClearance } from "@/models/BankClearance";
import { BankAccount } from "@/models/setupMasters";
import { moneyAccounts } from "@/lib/reports/financeReports";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const dec = (v: unknown) => new Decimal(String(v ?? 0));

/** Bank ledgers only — cash in hand has no statement to reconcile against. */
export async function reconcilableAccounts(businessId: Types.ObjectId) {
  const [money, banks] = await Promise.all([
    moneyAccounts(businessId),
    BankAccount.find({ businessId, deletedAt: null }, { accountName: 1, bankName: 1, accountNumber: 1, ledgerAccountId: 1 }).lean<AnyDoc[]>(),
  ]);
  const bankByLedger = new Map(banks.filter((b) => b.ledgerAccountId).map((b) => [b.ledgerAccountId.toString(), b]));
  return money
    .filter((a) => a.systemRole !== "CASH")
    .map((a) => {
      const b = bankByLedger.get(a._id.toString());
      return {
        id: a._id.toString(),
        label: b ? `${b.accountName} — ${b.bankName} ····${String(b.accountNumber).slice(-4)}` : `${a.code} · ${a.name}`,
      };
    });
}

export const reconQuerySchema = z.object({
  accountId: z.string().trim().min(1),
  asOf: z.string().trim().optional(),
  show: z.enum(["UNCLEARED", "ALL"]).default("UNCLEARED"),
});

/**
 * The bank reconciliation statement for one account as at a date: the book
 * balance, what has not yet hit the bank, and therefore what the statement
 * should show. Any gap between that and the real statement is an error or a
 * missing entry to chase.
 */
export async function getReconciliation(businessId: Types.ObjectId, q: z.infer<typeof reconQuerySchema>) {
  if (!Types.ObjectId.isValid(q.accountId)) throw AppError.badRequest("Choose a bank account", "NO_ACCOUNT");
  const allowed = new Set((await reconcilableAccounts(businessId)).map((a) => a.id));
  if (!allowed.has(q.accountId)) throw AppError.badRequest("That account is not a bank account", "NOT_BANK");

  const account = await Account.findOne({ _id: q.accountId, businessId }).lean<AnyDoc>();
  if (!account) throw AppError.notFound("Account not found");
  const asOf = q.asOf ? new Date(`${q.asOf}T23:59:59.999`) : new Date();
  const accountId = new Types.ObjectId(q.accountId);

  const [vouchers, clearances] = await Promise.all([
    Voucher.find({ businessId, status: "POSTED", voucherDate: { $lte: asOf }, "lines.accountId": accountId })
      .sort({ voucherDate: 1, createdAt: 1 })
      .lean<AnyDoc[]>(),
    BankClearance.find({ businessId, accountId }).lean<AnyDoc[]>(),
  ]);
  const clearedAt = new Map(clearances.map((c) => [`${c.voucherId.toString()}:${c.lineIndex}`, c.clearedDate as Date]));

  const seeded = dec(account.openingBalance);
  let book = account.openingBalanceType === NORMAL_BALANCE[account.type as AccountType] ? seeded : seeded.negated();
  let unclearedIn = new Decimal(0);
  let unclearedOut = new Decimal(0);
  const rows: Record<string, unknown>[] = [];

  for (const v of vouchers) {
    (v.lines as AnyDoc[]).forEach((l, lineIndex) => {
      if (l.accountId.toString() !== q.accountId) return;
      const debit = dec(l.debit);
      const credit = dec(l.credit);
      book = book.plus(debit).minus(credit);
      const cd = clearedAt.get(`${v._id.toString()}:${lineIndex}`) ?? null;
      const clearedByAsOf = cd !== null && cd <= asOf;
      if (!clearedByAsOf) {
        unclearedIn = unclearedIn.plus(debit);
        unclearedOut = unclearedOut.plus(credit);
      }
      if (q.show === "ALL" || !clearedByAsOf) {
        rows.push({
          voucherId: v._id.toString(),
          lineIndex,
          date: v.voucherDate.toISOString(),
          voucherNumber: v.voucherNumber,
          particulars:
            (v.lines as AnyDoc[])
              .filter((x) => x.accountId.toString() !== q.accountId)
              .map((x) => x.accountName)
              .join(", ") || "—",
          reference: v.sourceNumber ?? v.referenceNumber ?? null,
          deposit: debit.toFixed(2),
          withdrawal: credit.toFixed(2),
          clearedDate: cd ? cd.toISOString().slice(0, 10) : null,
        });
      }
    });
  }

  const expectedBank = book.minus(unclearedIn).plus(unclearedOut);
  return {
    account: { id: q.accountId, name: account.name, code: account.code },
    asOf: asOf.toISOString().slice(0, 10),
    bookBalance: book.toFixed(2),
    unclearedDeposits: unclearedIn.toFixed(2),
    unclearedWithdrawals: unclearedOut.toFixed(2),
    expectedBankBalance: expectedBank.toFixed(2),
    rows: rows.reverse(),
  };
}

export const clearanceSchema = z.object({
  accountId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        voucherId: z.string().trim().min(1),
        lineIndex: z.coerce.number().int().min(0),
        clearedDate: z.string().trim().nullable(),
      })
    )
    .min(1)
    .max(500),
});

/** Marks lines cleared (with the statement date) or un-clears them. */
export async function saveClearances(input: z.infer<typeof clearanceSchema>, ctx: AuthContext) {
  const accountId = new Types.ObjectId(input.accountId);
  const voucherIds = [...new Set(input.items.map((i) => i.voucherId))].map((id) => new Types.ObjectId(id));
  const vouchers = await Voucher.find({ businessId: ctx.businessId, _id: { $in: voucherIds } }, { lines: 1, voucherDate: 1 }).lean<AnyDoc[]>();
  const byId = new Map(vouchers.map((v) => [v._id.toString(), v]));

  let cleared = 0;
  let uncleared = 0;
  for (const item of input.items) {
    const v = byId.get(item.voucherId);
    const line = v?.lines?.[item.lineIndex];
    if (!v || !line || line.accountId.toString() !== input.accountId) {
      throw AppError.badRequest("A selected entry does not belong to this bank account", "BAD_LINE");
    }
    const key = { businessId: ctx.businessId, voucherId: v._id, lineIndex: item.lineIndex };
    if (item.clearedDate) {
      const date = new Date(item.clearedDate);
      if (Number.isNaN(date.getTime())) throw AppError.badRequest("Invalid cleared date", "BAD_DATE");
      if (date < new Date(new Date(v.voucherDate).toISOString().slice(0, 10))) {
        throw AppError.badRequest("An entry cannot clear the bank before its own date", "CLEARED_TOO_EARLY");
      }
      await BankClearance.updateOne(key, { $set: { accountId, clearedDate: date, clearedBy: ctx.userId } }, { upsert: true });
      cleared += 1;
    } else {
      await BankClearance.deleteOne(key);
      uncleared += 1;
    }
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "bank-reconciliation",
    documentType: "Bank reconciliation",
    newValue: { accountId: input.accountId, cleared, uncleared },
  });
  return { cleared, uncleared };
}

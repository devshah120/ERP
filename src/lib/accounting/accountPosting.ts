import { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import { Account } from "@/models/Account";
import { Voucher, type VoucherType } from "@/models/Voucher";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { toDecimal128 } from "@/lib/documents/decimal128";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const PREFIX: Record<VoucherType, string> = { JOURNAL: "JV", PAYMENT: "PV", RECEIPT: "RV", CONTRA: "CV", SALES: "SV", PURCHASE: "PUV" };

export interface AccountEntry {
  accountId: Types.ObjectId;
  debit?: Decimal;
  credit?: Decimal;
  narration?: string;
}

/**
 * Posts a balanced voucher against specific accounts — for documents where
 * the user picks the account (an expense head, a bank ledger) rather than the
 * engine resolving it by system role. Same rules as postVoucher: zero lines
 * dropped, debits must equal credits, never a group account, always inside
 * the caller's transaction.
 */
export async function postAccountVoucher(params: {
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYear: { _id: Types.ObjectId; label: string };
  userId: Types.ObjectId;
  voucherType: VoucherType;
  voucherDate: Date;
  entries: AccountEntry[];
  narration?: string;
  referenceNumber?: string;
  source: { type: string; id: Types.ObjectId; number: string };
  session: ClientSession;
}) {
  const material = params.entries.filter((e) => (e.debit ?? new Decimal(0)).abs().gte("0.005") || (e.credit ?? new Decimal(0)).abs().gte("0.005"));
  if (material.length === 0) return null;

  const accounts = await Account.find(
    { businessId: params.businessId, _id: { $in: material.map((e) => e.accountId) } },
    { code: 1, name: 1, isGroup: 1 },
    { session: params.session }
  ).lean<AnyDoc[]>();
  const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const lines = material.map((e) => {
    const a = byId.get(e.accountId.toString());
    if (!a) throw AppError.badRequest("Account not found", "ACCOUNT_NOT_FOUND");
    if (a.isGroup) throw AppError.badRequest(`"${a.name}" is a group heading, not a posting account`, "GROUP_ACCOUNT");
    const debit = e.debit ?? new Decimal(0);
    const credit = e.credit ?? new Decimal(0);
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    return { accountId: a._id, accountCode: a.code, accountName: a.name, debit: toDecimal128(debit), credit: toDecimal128(credit), narration: e.narration };
  });

  if (!totalDebit.minus(totalCredit).abs().lt("0.005")) {
    throw AppError.badRequest(`Journal entry does not balance: ${totalDebit.toFixed(2)} vs ${totalCredit.toFixed(2)}`, "UNBALANCED_VOUCHER");
  }

  const { formatted } = await getNextDocumentNumber({
    businessId: params.businessId,
    branchId: params.branchId,
    financialYearId: params.financialYear._id,
    documentType: `VOUCHER_${params.voucherType}`,
    prefix: PREFIX[params.voucherType],
    financialYearLabel: params.financialYear.label,
  });

  const [voucher] = await Voucher.create(
    [
      {
        businessId: params.businessId,
        branchId: params.branchId,
        financialYearId: params.financialYear._id,
        voucherNumber: formatted,
        voucherDate: params.voucherDate,
        voucherType: params.voucherType,
        lines,
        totalDebit: toDecimal128(totalDebit),
        totalCredit: toDecimal128(totalCredit),
        narration: params.narration,
        referenceNumber: params.referenceNumber,
        sourceType: params.source.type,
        sourceId: params.source.id,
        sourceNumber: params.source.number,
        isSystemGenerated: true,
        status: "POSTED",
        createdBy: params.userId,
      },
    ],
    { session: params.session }
  );
  return voucher;
}

/**
 * Reverses a document's voucher line-for-line by account id. Unlike
 * reverseVoucherFor, this works when the accounts have no system role.
 */
export async function reverseAccountVoucher(params: {
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYear: { _id: Types.ObjectId; label: string };
  userId: Types.ObjectId;
  sourceType: string;
  sourceId: Types.ObjectId;
  reason?: string;
  session: ClientSession;
}) {
  const original = await Voucher.findOne({
    businessId: params.businessId,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    status: "POSTED",
  }).session(params.session);
  if (!original) return null;

  original.status = "CANCELLED";
  original.cancelledBy = params.userId;
  original.cancelledAt = new Date();
  original.cancellationReason = params.reason;
  await original.save({ session: params.session });

  return postAccountVoucher({
    businessId: params.businessId,
    branchId: params.branchId,
    financialYear: params.financialYear,
    userId: params.userId,
    voucherType: "JOURNAL",
    voucherDate: new Date(),
    entries: (original.lines as AnyDoc[]).map((l) => ({
      accountId: l.accountId,
      debit: new Decimal(String(l.credit ?? 0)),
      credit: new Decimal(String(l.debit ?? 0)),
      narration: l.narration,
    })),
    narration: `Reversal of ${original.voucherNumber}${params.reason ? ` — ${params.reason}` : ""}`,
    source: { type: `${params.sourceType}_REVERSAL`, id: params.sourceId, number: original.voucherNumber },
    session: params.session,
  });
}

import { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import { Account, type SystemAccountRole } from "@/models/Account";
import { Voucher, type VoucherType } from "@/models/Voucher";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { loadSystemAccounts } from "./chartOfAccounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/** One side of a journal entry, before it is resolved to an account row. */
export interface PostingEntry {
  role: SystemAccountRole;
  debit?: Decimal;
  credit?: Decimal;
  narration?: string;
}

export interface PostVoucherParams {
  businessId: Types.ObjectId;
  userId?: Types.ObjectId | null;
  voucherType: VoucherType;
  voucherDate: Date;
  entries: PostingEntry[];
  narration?: string;
  referenceNumber?: string;
  /** Links the voucher to the document that caused it, and makes it idempotent. */
  source?: { type: string; id: Types.ObjectId; number: string };
  session: ClientSession;
}

const ZERO = new Decimal(0);

/** Amounts below half a paise are rounding noise, not entries worth posting. */
function isMaterial(value: Decimal): boolean {
  return value.abs().gte("0.005");
}

/**
 * Writes one balanced journal voucher.
 *
 * Refuses to post if debits and credits disagree — an unbalanced voucher is
 * not a smaller problem than no voucher, it is a corrupt ledger that every
 * later report silently inherits. Zero-value entries are dropped first, so a
 * document with no GST does not produce empty tax lines.
 *
 * Always runs inside the caller's transaction: the voucher and whatever
 * caused it must land together or not at all.
 */
export async function postVoucher(params: PostVoucherParams): Promise<AnyDoc | null> {
  const { businessId, voucherType, voucherDate, entries, session } = params;

  const material = entries.filter((e) => isMaterial(e.debit ?? ZERO) || isMaterial(e.credit ?? ZERO));
  if (material.length === 0) return null;

  const accounts = await loadSystemAccounts(businessId, session);
  const missing = material.map((e) => e.role).filter((role) => !accounts.has(role));
  if (missing.length > 0) {
    throw AppError.badRequest(
      `Chart of accounts is missing: ${[...new Set(missing)].join(", ")}. Open Chart of Accounts and run setup.`,
      "COA_INCOMPLETE"
    );
  }

  let totalDebit = ZERO;
  let totalCredit = ZERO;
  const lines = material.map((e) => {
    const account = accounts.get(e.role)!;
    const debit = e.debit ?? ZERO;
    const credit = e.credit ?? ZERO;
    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);
    return {
      accountId: account._id,
      accountCode: account.code,
      accountName: account.name,
      debit: toDecimal128(debit),
      credit: toDecimal128(credit),
      narration: e.narration,
    };
  });

  if (!totalDebit.minus(totalCredit).abs().lt("0.005")) {
    throw AppError.badRequest(
      `Journal entry does not balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}.`,
      "UNBALANCED_VOUCHER"
    );
  }

  const [business, financialYear] = await Promise.all([
    Business.findById(businessId).session(session).lean(),
    FinancialYear.findOne({ businessId, isCurrent: true }).session(session).lean(),
  ]);
  if (!business?.defaultBranchId) throw AppError.badRequest("Business has no default branch", "NO_BRANCH");
  if (!financialYear) throw AppError.badRequest("No open financial year", "NO_FINANCIAL_YEAR");

  const { formatted } = await getNextDocumentNumber({
    businessId,
    branchId: business.defaultBranchId,
    financialYearId: financialYear._id,
    documentType: `VOUCHER_${voucherType}`,
    prefix: VOUCHER_PREFIX[voucherType],
    financialYearLabel: financialYear.label,
  });

  try {
    const docs = await Voucher.create(
      [
        {
          businessId,
          branchId: business.defaultBranchId,
          financialYearId: financialYear._id,
          voucherNumber: formatted,
          voucherDate,
          voucherType,
          lines,
          totalDebit: toDecimal128(totalDebit),
          totalCredit: toDecimal128(totalCredit),
          narration: params.narration,
          referenceNumber: params.referenceNumber,
          sourceType: params.source?.type ?? null,
          sourceId: params.source?.id ?? null,
          sourceNumber: params.source?.number ?? null,
          isSystemGenerated: Boolean(params.source),
          status: "POSTED",
          createdBy: params.userId ?? null,
        },
      ],
      { session }
    );
    return docs[0];
  } catch (err) {
    // The unique (businessId, sourceType, sourceId) index makes re-posting a
    // no-op rather than a duplicate — exactly what a backfill re-run needs.
    if ((err as { code?: number }).code === 11000 && params.source) return null;
    throw err;
  }
}

const VOUCHER_PREFIX: Record<VoucherType, string> = {
  JOURNAL: "JV",
  PAYMENT: "PV",
  RECEIPT: "RV",
  CONTRA: "CV",
  SALES: "SV",
  PURCHASE: "PUV",
};

/* ================================================================== */
/* Document → journal entry rules                                      */
/* ================================================================== */

const dec = (v: unknown) => new Decimal(String(v ?? 0));

/**
 * Sales invoice: the customer owes the full amount; revenue, the GST
 * collected on the government's behalf, and any freight charged are the
 * credits that make it up.
 */
export function salesInvoiceEntries(doc: AnyDoc): PostingEntry[] {
  const t = doc.totals ?? {};
  const roundOff = dec(t.roundOff);
  return [
    { role: "ACCOUNTS_RECEIVABLE", debit: dec(t.grandTotal), narration: doc.customer?.name },
    { role: "SALES", credit: dec(t.taxableAmount) },
    { role: "OUTPUT_CGST", credit: dec(t.cgstAmount) },
    { role: "OUTPUT_SGST", credit: dec(t.sgstAmount) },
    { role: "OUTPUT_IGST", credit: dec(t.igstAmount) },
    { role: "FREIGHT_INCOME", credit: dec(t.shippingCharge) },
    // Round-off can fall either way, so it is posted on whichever side keeps
    // the voucher balanced.
    roundOff.gte(0)
      ? { role: "ROUND_OFF", credit: roundOff }
      : { role: "ROUND_OFF", debit: roundOff.abs() },
  ];
}

/** Purchase invoice: the mirror image — stock/expense and recoverable GST in,
 *  a liability to the supplier out. */
export function purchaseInvoiceEntries(doc: AnyDoc): PostingEntry[] {
  const t = doc.totals ?? {};
  const roundOff = dec(t.roundOff);
  return [
    { role: "PURCHASES", debit: dec(t.taxableAmount) },
    { role: "INPUT_CGST", debit: dec(t.cgstAmount) },
    { role: "INPUT_SGST", debit: dec(t.sgstAmount) },
    { role: "INPUT_IGST", debit: dec(t.igstAmount) },
    { role: "FREIGHT_EXPENSE", debit: dec(t.shippingCharge) },
    roundOff.gte(0)
      ? { role: "ROUND_OFF", debit: roundOff }
      : { role: "ROUND_OFF", credit: roundOff.abs() },
    { role: "ACCOUNTS_PAYABLE", credit: dec(t.grandTotal), narration: doc.vendor?.name },
  ];
}

/** Credit note: reverses a sale, reducing both the receivable and the GST
 *  originally charged. */
export function creditNoteEntries(doc: AnyDoc): PostingEntry[] {
  const t = doc.totals ?? {};
  return [
    { role: "SALES_RETURNS", debit: dec(t.taxableAmount) },
    { role: "OUTPUT_CGST", debit: dec(t.cgstAmount) },
    { role: "OUTPUT_SGST", debit: dec(t.sgstAmount) },
    { role: "OUTPUT_IGST", debit: dec(t.igstAmount) },
    { role: "ACCOUNTS_RECEIVABLE", credit: dec(t.grandTotal), narration: doc.customer?.name },
  ];
}

/** Debit note: reverses a purchase. */
export function debitNoteEntries(doc: AnyDoc): PostingEntry[] {
  const t = doc.totals ?? {};
  return [
    { role: "ACCOUNTS_PAYABLE", debit: dec(t.grandTotal), narration: doc.vendor?.name },
    { role: "PURCHASE_RETURNS", credit: dec(t.taxableAmount) },
    { role: "INPUT_CGST", credit: dec(t.cgstAmount) },
    { role: "INPUT_SGST", credit: dec(t.sgstAmount) },
    { role: "INPUT_IGST", credit: dec(t.igstAmount) },
  ];
}

/** Which asset account the money landed in or left from. */
function cashRole(mode: string): SystemAccountRole {
  return mode === "CASH" ? "CASH" : "BANK";
}

/**
 * Receipt: money in. What was matched to invoices clears the receivable;
 * anything unmatched is a liability — the business is holding a customer's
 * money against nothing yet.
 */
export function receiptEntries(payment: AnyDoc): PostingEntry[] {
  const allocated = dec(payment.allocatedAmount);
  const onAccount = dec(payment.unallocatedAmount);
  return [
    { role: cashRole(payment.mode), debit: dec(payment.amount), narration: payment.party?.name },
    { role: "ACCOUNTS_RECEIVABLE", credit: allocated },
    { role: "CUSTOMER_ADVANCES", credit: onAccount },
  ];
}

/** Payment: money out, clearing payables and parking anything unmatched as an
 *  advance to the supplier. */
export function paymentEntries(payment: AnyDoc): PostingEntry[] {
  const allocated = dec(payment.allocatedAmount);
  const onAccount = dec(payment.unallocatedAmount);
  return [
    { role: "ACCOUNTS_PAYABLE", debit: allocated, narration: payment.party?.name },
    { role: "SUPPLIER_ADVANCES", debit: onAccount },
    { role: cashRole(payment.mode), credit: dec(payment.amount) },
  ];
}

/**
 * Stock adjustment: a gain adds to inventory, a loss writes it off. Transfers
 * between warehouses post nothing — the goods never left the business, so
 * there is no accounting event.
 */
export function stockAdjustmentEntries(value: Decimal): PostingEntry[] {
  if (value.gte(0)) {
    return [
      { role: "INVENTORY", debit: value },
      { role: "STOCK_ADJUSTMENT", credit: value },
    ];
  }
  return [
    { role: "STOCK_ADJUSTMENT", debit: value.abs() },
    { role: "INVENTORY", credit: value.abs() },
  ];
}

/**
 * Reverses a voucher by posting its mirror image rather than deleting it.
 * A cancelled invoice that simply lost its journal entry would leave last
 * month's trial balance unreproducible.
 */
export async function reverseVoucherFor(params: {
  businessId: Types.ObjectId;
  userId?: Types.ObjectId | null;
  sourceType: string;
  sourceId: Types.ObjectId;
  reason?: string;
  session: ClientSession;
}): Promise<AnyDoc | null> {
  const { businessId, sourceType, sourceId, session } = params;

  const original = await Voucher.findOne({ businessId, sourceType, sourceId, status: "POSTED" }).session(session);
  if (!original) return null;

  const entries: PostingEntry[] = [];
  const accounts = await Account.find(
    { businessId, _id: { $in: original.lines.map((l: AnyDoc) => l.accountId) } },
    { systemRole: 1 },
    { session }
  ).lean();
  const roleById = new Map(accounts.map((a) => [a._id.toString(), a.systemRole]));

  for (const line of original.lines as AnyDoc[]) {
    const role = roleById.get(line.accountId.toString());
    if (!role) continue;
    entries.push({
      role,
      debit: dec(line.credit),
      credit: dec(line.debit),
      narration: line.narration,
    });
  }

  original.status = "CANCELLED";
  original.cancelledBy = params.userId ?? null;
  original.cancelledAt = new Date();
  original.cancellationReason = params.reason;
  await original.save({ session });

  return postVoucher({
    businessId,
    userId: params.userId,
    voucherType: "JOURNAL",
    voucherDate: new Date(),
    entries,
    narration: `Reversal of ${original.voucherNumber}${params.reason ? ` — ${params.reason}` : ""}`,
    source: { type: `${sourceType}_REVERSAL`, id: sourceId, number: original.voucherNumber },
    session,
  });
}

/**
 * Posts a document's journal entry, swallowing the "accounting not set up
 * yet" case.
 *
 * Auto-posting must never block the operational side of the business: if a
 * tenant has not created a chart of accounts, posting an invoice still has to
 * work. The gap is then closed by the backfill, which is idempotent.
 */
export async function tryPostDocument(params: PostVoucherParams): Promise<AnyDoc | null> {
  try {
    return await postVoucher(params);
  } catch (err) {
    if (err instanceof AppError && err.code === "COA_INCOMPLETE") {
      console.warn(
        `[LEDGER] Skipped posting ${params.source?.type} ${params.source?.number}: chart of accounts not set up.`
      );
      return null;
    }
    throw err;
  }
}

/** True once a tenant has a chart of accounts, so the UI can tell the user. */
export async function isAccountingEnabled(businessId: Types.ObjectId): Promise<boolean> {
  return (await Account.countDocuments({ businessId })) > 0;
}

import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Account } from "@/models/Account";
import { Voucher, VOUCHER_TYPES } from "@/models/Voucher";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { SalesInvoice, CreditNote } from "@/models/salesDocuments";
import { PurchaseInvoice, DebitNote } from "@/models/purchaseDocuments";
import { Payment } from "@/models/Payment";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { moneyStringSchema } from "@/lib/validation/money";
import {
  postVoucher,
  reverseVoucherFor,
  salesInvoiceEntries,
  purchaseInvoiceEntries,
  creditNoteEntries,
  debitNoteEntries,
  receiptEntries,
  paymentEntries,
} from "./posting";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

export const voucherCreateSchema = z.object({
  voucherDate: z.string().trim().optional(),
  voucherType: z.enum(VOUCHER_TYPES).default("JOURNAL"),
  narration: z.string().trim().max(2000).optional(),
  referenceNumber: z.string().trim().max(60).optional(),
  lines: z
    .array(
      z.object({
        accountId: z.string().trim().min(1),
        debit: moneyStringSchema.default("0"),
        credit: moneyStringSchema.default("0"),
        narration: z.string().trim().max(300).optional(),
      })
    )
    .min(2, "A journal entry needs at least two lines"),
});
export type VoucherCreateInput = z.infer<typeof voucherCreateSchema>;

export const voucherListSchema = z.object({
  query: z.string().trim().max(200).optional(),
  voucherType: z.string().trim().max(20).optional(),
  accountId: z.string().trim().optional(),
  status: z.string().trim().max(20).optional(),
  source: z.enum(["MANUAL", "SYSTEM"]).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});

/**
 * Records a hand-written journal entry.
 *
 * Unlike the auto-posted vouchers, the account on each line is chosen by the
 * user, so this path resolves real account ids instead of system roles — but
 * it applies the same balance rule, and refuses to post to a group account
 * (a heading is not somewhere money can sit).
 */
export async function createVoucher(input: VoucherCreateInput, ctx: AuthContext) {
  const [business, financialYear] = await Promise.all([
    Business.findById(ctx.businessId).lean(),
    FinancialYear.findOne({ businessId: ctx.businessId, isCurrent: true }).lean(),
  ]);
  if (!business?.defaultBranchId) throw AppError.badRequest("Business has no default branch", "NO_BRANCH");
  if (!financialYear) throw AppError.badRequest("No open financial year", "NO_FINANCIAL_YEAR");

  const accountIds = input.lines.map((l) => l.accountId);
  const accounts = await Account.find({
    businessId: ctx.businessId,
    _id: { $in: accountIds.map((id) => new Types.ObjectId(id)) },
  }).lean<AnyDoc[]>();
  const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

  let totalDebit = new Decimal(0);
  let totalCredit = new Decimal(0);
  const lines = input.lines.map((line) => {
    const account = byId.get(line.accountId);
    if (!account) throw AppError.badRequest(`Account ${line.accountId} not found`, "ACCOUNT_NOT_FOUND");
    if (account.isGroup) {
      throw AppError.badRequest(
        `"${account.name}" is a group heading, not a posting account. Choose an account underneath it.`,
        "GROUP_ACCOUNT"
      );
    }
    if (account.status !== "ACTIVE") {
      throw AppError.badRequest(`"${account.name}" is inactive`, "INACTIVE_ACCOUNT");
    }

    const debit = new Decimal(line.debit || "0");
    const credit = new Decimal(line.credit || "0");
    if (debit.lt(0) || credit.lt(0)) {
      throw AppError.badRequest("Amounts cannot be negative — use the other column instead", "NEGATIVE_AMOUNT");
    }
    if (debit.gt(0) && credit.gt(0)) {
      throw AppError.badRequest(
        `"${account.name}" has both a debit and a credit. A line is one or the other.`,
        "BOTH_SIDES"
      );
    }
    if (debit.eq(0) && credit.eq(0)) {
      throw AppError.badRequest(`"${account.name}" has no amount on either side`, "EMPTY_LINE");
    }

    totalDebit = totalDebit.plus(debit);
    totalCredit = totalCredit.plus(credit);

    return {
      accountId: account._id,
      accountCode: account.code,
      accountName: account.name,
      debit: toDecimal128(debit),
      credit: toDecimal128(credit),
      narration: line.narration,
    };
  });

  if (!totalDebit.minus(totalCredit).abs().lt("0.005")) {
    throw AppError.badRequest(
      `Debits (${totalDebit.toFixed(2)}) and credits (${totalCredit.toFixed(2)}) must be equal. Difference: ${totalDebit.minus(totalCredit).abs().toFixed(2)}.`,
      "UNBALANCED_VOUCHER"
    );
  }

  const session = await mongoose.startSession();
  let created: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId: business.defaultBranchId!,
        financialYearId: financialYear._id,
        documentType: `VOUCHER_${input.voucherType}`,
        prefix: { JOURNAL: "JV", PAYMENT: "PV", RECEIPT: "RV", CONTRA: "CV", SALES: "SV", PURCHASE: "PUV" }[
          input.voucherType
        ],
        financialYearLabel: financialYear.label,
      });

      const docs = await Voucher.create(
        [
          {
            businessId: ctx.businessId,
            branchId: business.defaultBranchId,
            financialYearId: financialYear._id,
            voucherNumber: formatted,
            voucherDate: input.voucherDate ? new Date(input.voucherDate) : new Date(),
            voucherType: input.voucherType,
            lines,
            totalDebit: toDecimal128(totalDebit),
            totalCredit: toDecimal128(totalCredit),
            narration: input.narration,
            referenceNumber: input.referenceNumber,
            isSystemGenerated: false,
            status: "POSTED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );
      created = docs[0];
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "vouchers",
    documentType: "vouchers",
    documentId: created!._id,
    newValue: { voucherNumber: created!.voucherNumber, totalDebit: totalDebit.toFixed(2) },
  });

  return serializeDoc(created!);
}

/**
 * Cancels a voucher by posting its mirror image.
 *
 * A system-generated voucher cannot be cancelled on its own — it belongs to a
 * document, and cancelling only the accounting half would leave the invoice
 * saying one thing and the ledger another.
 */
export async function cancelVoucher(id: string, reason: string | undefined, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Voucher not found");

  const voucher = await Voucher.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!voucher) throw AppError.notFound("Voucher not found");
  if (voucher.status === "CANCELLED") {
    throw AppError.badRequest("This voucher is already cancelled", "ALREADY_CANCELLED");
  }
  if (voucher.isSystemGenerated) {
    throw AppError.badRequest(
      `${voucher.voucherNumber} was posted automatically by ${voucher.sourceNumber ?? "a document"}. Cancel that document instead — the ledger will follow.`,
      "SYSTEM_VOUCHER"
    );
  }

  const session = await mongoose.startSession();
  let result: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const doc = await Voucher.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      if (!doc) throw AppError.notFound("Voucher not found");

      const accounts = await Account.find(
        { businessId: ctx.businessId, _id: { $in: doc.lines.map((l: AnyDoc) => l.accountId) } },
        { code: 1, name: 1 }
      )
        .session(session)
        .lean<AnyDoc[]>();
      const byId = new Map(accounts.map((a) => [a._id.toString(), a]));

      let totalDebit = new Decimal(0);
      let totalCredit = new Decimal(0);
      const reversed = doc.lines.map((l: AnyDoc) => {
        const account = byId.get(l.accountId.toString());
        const debit = new Decimal(String(l.credit ?? 0));
        const credit = new Decimal(String(l.debit ?? 0));
        totalDebit = totalDebit.plus(debit);
        totalCredit = totalCredit.plus(credit);
        return {
          accountId: l.accountId,
          accountCode: account?.code ?? l.accountCode,
          accountName: account?.name ?? l.accountName,
          debit: toDecimal128(debit),
          credit: toDecimal128(credit),
          narration: l.narration,
        };
      });

      const business = await Business.findById(ctx.businessId).session(session).lean();
      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId: business!.defaultBranchId!,
        financialYearId: doc.financialYearId,
        documentType: "VOUCHER_JOURNAL",
        prefix: "JV",
        financialYearLabel: (
          await FinancialYear.findById(doc.financialYearId).session(session).lean()
        )!.label,
      });

      await Voucher.create(
        [
          {
            businessId: ctx.businessId,
            branchId: doc.branchId,
            financialYearId: doc.financialYearId,
            voucherNumber: formatted,
            voucherDate: new Date(),
            voucherType: "JOURNAL",
            lines: reversed,
            totalDebit: toDecimal128(totalDebit),
            totalCredit: toDecimal128(totalCredit),
            narration: `Reversal of ${doc.voucherNumber}${reason ? ` — ${reason}` : ""}`,
            isSystemGenerated: false,
            status: "POSTED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      doc.status = "CANCELLED";
      doc.cancelledBy = ctx.userId;
      doc.cancelledAt = new Date();
      doc.cancellationReason = reason;
      await doc.save({ session });
      result = doc;
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CANCEL",
    module: "vouchers",
    documentType: "vouchers",
    documentId: result!._id,
    reason,
  });

  return serializeDoc(result!);
}

export async function getVoucher(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Voucher not found");
  const doc = await Voucher.findOne({ _id: id, businessId: ctx.businessId }).lean();
  if (!doc) throw AppError.notFound("Voucher not found");
  return serializeDoc(doc);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listVouchers(
  searchParams: URLSearchParams,
  ctx: AuthContext,
  options: { pageSizeOverride?: number } = {}
) {
  const parsed = voucherListSchema.parse(Object.fromEntries(searchParams.entries()));
  const pageSize = options.pageSizeOverride ?? parsed.pageSize;

  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (parsed.voucherType) filter.voucherType = parsed.voucherType;
  if (parsed.status) filter.status = parsed.status;
  if (parsed.accountId) filter["lines.accountId"] = new Types.ObjectId(parsed.accountId);
  if (parsed.source) filter.isSystemGenerated = parsed.source === "SYSTEM";
  if (parsed.query) {
    const rx = { $regex: escapeRegex(parsed.query), $options: "i" };
    filter.$or = [{ voucherNumber: rx }, { narration: rx }, { referenceNumber: rx }, { sourceNumber: rx }];
  }
  if (parsed.fromDate || parsed.toDate) {
    const range: Record<string, Date> = {};
    if (parsed.fromDate) range.$gte = new Date(parsed.fromDate);
    if (parsed.toDate) {
      const to = new Date(parsed.toDate);
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.voucherDate = range;
  }

  const skip = (parsed.page - 1) * pageSize;
  const [docs, total] = await Promise.all([
    Voucher.find(filter).sort({ voucherDate: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Voucher.countDocuments(filter),
  ]);

  return {
    items: (docs as AnyDoc[]).map((d) => {
      const row = serializeDoc(d) as Record<string, unknown>;
      row.lineCount = d.lines?.length ?? 0;
      row.accountSummary = d.lines
        .slice(0, 3)
        .map((l: AnyDoc) => l.accountName)
        .join(", ");
      return row;
    }),
    total,
    page: parsed.page,
    pageSize,
  };
}

/* ================================================================== */
/* Backfill                                                            */
/* ================================================================== */

/**
 * Posts journal entries for documents that were completed before accounting
 * was switched on.
 *
 * Idempotent by construction: the unique (businessId, sourceType, sourceId)
 * index means a document that already has a voucher is skipped by the
 * database, so running this twice cannot double-count anything. That is the
 * difference between a backfill you can trust and one you run once and pray.
 */
export async function backfillLedger(ctx: AuthContext) {
  const businessId = ctx.businessId;
  const summary: Record<string, { posted: number; skipped: number; failed: number }> = {};
  const errors: Array<{ source: string; documentNumber: string; message: string }> = [];

  const sources = [
    {
      key: "sales-invoices",
      model: SalesInvoice,
      filter: { status: { $in: ["POSTED", "PARTIALLY_PAID", "PAID"] } },
      type: "SALES" as const,
      entries: salesInvoiceEntries,
    },
    {
      key: "purchase-invoices",
      model: PurchaseInvoice,
      filter: { status: { $in: ["POSTED", "PARTIALLY_PAID", "PAID"] } },
      type: "PURCHASE" as const,
      entries: purchaseInvoiceEntries,
    },
    {
      key: "credit-notes",
      model: CreditNote,
      filter: { status: "ISSUED" },
      type: "JOURNAL" as const,
      entries: creditNoteEntries,
    },
    {
      key: "debit-notes",
      model: DebitNote,
      filter: { status: "ISSUED" },
      type: "JOURNAL" as const,
      entries: debitNoteEntries,
    },
  ];

  for (const source of sources) {
    summary[source.key] = { posted: 0, skipped: 0, failed: 0 };
    const docs = await source.model.find({ businessId, ...source.filter }).lean<AnyDoc[]>();

    for (const doc of docs) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const voucher = await postVoucher({
            businessId,
            userId: ctx.userId,
            voucherType: source.type,
            voucherDate: doc.documentDate ?? doc.createdAt,
            entries: source.entries(doc),
            narration: `${source.key} ${doc.documentNumber} (backfilled)`,
            referenceNumber: doc.documentNumber,
            source: { type: source.key, id: doc._id, number: doc.documentNumber },
            session,
          });
          if (voucher) summary[source.key].posted += 1;
          else summary[source.key].skipped += 1;
        });
      } catch (err) {
        // One document that fails or times out (a transient replica-set
        // hiccup, a stale index build) must not sink the whole backfill and
        // discard every voucher already posted before it. Record it and
        // move on — the operator sees exactly which documents still need
        // attention, and the operation stays idempotent to re-run.
        summary[source.key].failed += 1;
        errors.push({
          source: source.key,
          documentNumber: doc.documentNumber ?? String(doc._id),
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await session.endSession();
      }
    }
  }

  // Receipts and payments share one collection, split by direction.
  for (const [key, direction, type, entries] of [
    ["receipts", "RECEIPT", "RECEIPT", receiptEntries],
    ["payments", "PAYMENT", "PAYMENT", paymentEntries],
  ] as const) {
    summary[key] = { posted: 0, skipped: 0, failed: 0 };
    const docs = await Payment.find({ businessId, direction, status: "CONFIRMED" }).lean<AnyDoc[]>();

    for (const doc of docs) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const voucher = await postVoucher({
            businessId,
            userId: ctx.userId,
            voucherType: type,
            voucherDate: doc.documentDate,
            entries: entries(doc),
            narration: `${key} ${doc.documentNumber} (backfilled)`,
            referenceNumber: doc.documentNumber,
            source: { type: key, id: doc._id, number: doc.documentNumber },
            session,
          });
          if (voucher) summary[key].posted += 1;
          else summary[key].skipped += 1;
        });
      } catch (err) {
        summary[key].failed += 1;
        errors.push({
          source: key,
          documentNumber: doc.documentNumber ?? String(doc._id),
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        await session.endSession();
      }
    }
  }

  const posted = Object.values(summary).reduce((a, s) => a + s.posted, 0);
  const skipped = Object.values(summary).reduce((a, s) => a + s.skipped, 0);
  const failed = Object.values(summary).reduce((a, s) => a + s.failed, 0);

  await recordAudit({
    businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "vouchers",
    newValue: { backfill: summary, errors: errors.slice(0, 50) },
    reason: "Ledger backfill",
  });

  return { summary, posted, skipped, failed, errors };
}

export { reverseVoucherFor };

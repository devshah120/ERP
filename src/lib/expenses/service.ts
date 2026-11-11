import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Account } from "@/models/Account";
import { Expense } from "@/models/Expense";
import { moneyStringSchema } from "@/lib/validation/money";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { loadSystemAccounts } from "@/lib/accounting/chartOfAccounts";
import { postAccountVoucher, reverseAccountVoucher } from "@/lib/accounting/accountPosting";
import { moneyAccounts } from "@/lib/reports/financeReports";
import { resolveBusinessContext, escapeRegex, dayRange } from "@/lib/services/businessContext";
import { SEQUENCES } from "@/lib/numbering/catalogue";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

export const expenseCreateSchema = z.object({
  expenseDate: z.string().trim().min(1, "Date is required"),
  expenseAccountId: z.string().trim().min(1, "Choose the expense head"),
  paidFromAccountId: z.string().trim().min(1, "Choose where the money came from"),
  payee: z.string().trim().max(150).optional(),
  paymentMode: z.enum(["CASH", "BANK", "UPI", "CARD", "CHEQUE"]).default("CASH"),
  reference: z.string().trim().max(60).optional(),
  amount: moneyStringSchema.refine((v) => new Decimal(v).gt(0), "Amount must be more than zero"),
  taxRatePercent: z.coerce.number().min(0).max(100).default(0),
  interState: z.coerce.boolean().default(false),
  notes: z.string().trim().max(1000).optional(),
});

export const expenseListSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.string().trim().max(20).optional(),
  expenseAccountId: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});

/** The accounts an expense form can offer: expense heads and money accounts. */
export async function expenseOptions(businessId: Types.ObjectId) {
  const [heads, money] = await Promise.all([
    Account.find({ businessId, type: "EXPENSE", isGroup: false, status: "ACTIVE", deletedAt: null, systemRole: null })
      .sort({ code: 1 })
      .lean<AnyDoc[]>(),
    moneyAccounts(businessId),
  ]);
  return {
    expenseAccounts: heads.map((a) => ({ id: a._id.toString(), label: `${a.code} · ${a.name}` })),
    paidFromAccounts: money.filter((a) => a.status === "ACTIVE").map((a) => ({ id: a._id.toString(), label: `${a.code} · ${a.name}`, role: a.systemRole ?? null })),
  };
}

export async function createExpense(input: z.infer<typeof expenseCreateSchema>, ctx: AuthContext) {
  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);

  const [head, from] = await Promise.all([
    Account.findOne({ _id: input.expenseAccountId, businessId: ctx.businessId }).lean<AnyDoc>(),
    Account.findOne({ _id: input.paidFromAccountId, businessId: ctx.businessId }).lean<AnyDoc>(),
  ]);
  if (!head || head.type !== "EXPENSE" || head.isGroup) throw AppError.badRequest("Choose an expense account", "BAD_EXPENSE_ACCOUNT");
  const money = new Set((await moneyAccounts(ctx.businessId)).map((a) => a._id.toString()));
  if (!from || !money.has(from._id.toString())) throw AppError.badRequest("Paid from must be a cash or bank account", "BAD_PAID_FROM");

  const amount = new Decimal(input.amount);
  const tax = amount.times(input.taxRatePercent).div(100).toDecimalPlaces(2);
  const half = tax.div(2).toDecimalPlaces(2);
  const cgst = input.interState ? new Decimal(0) : half;
  const sgst = input.interState ? new Decimal(0) : tax.minus(half);
  const igst = input.interState ? tax : new Decimal(0);
  const total = amount.plus(tax);

  let gstAccounts: Map<string, { _id: Types.ObjectId }> | null = null;
  if (tax.gt(0)) {
    gstAccounts = (await loadSystemAccounts(ctx.businessId)) as unknown as Map<string, { _id: Types.ObjectId }>;
    const need = input.interState ? ["INPUT_IGST"] : ["INPUT_CGST", "INPUT_SGST"];
    const missing = need.filter((r) => !gstAccounts!.has(r));
    if (missing.length) throw AppError.badRequest(`Chart of accounts is missing ${missing.join(", ")}`, "COA_INCOMPLETE");
  }

  const session = await mongoose.startSession();
  let created: AnyDoc;
  try {
    await session.withTransaction(async () => {
      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId,
        financialYearId: financialYear._id,
        documentType: SEQUENCES.EXPENSE.documentType,
        prefix: SEQUENCES.EXPENSE.defaultPrefix,
        financialYearLabel: financialYear.label,
      });

      [created] = await Expense.create(
        [
          {
            businessId: ctx.businessId,
            branchId,
            financialYearId: financialYear._id,
            expenseNumber: formatted,
            expenseDate: new Date(input.expenseDate),
            expenseAccountId: head._id,
            expenseAccountName: head.name,
            paidFromAccountId: from._id,
            paidFromAccountName: from.name,
            payee: input.payee,
            paymentMode: input.paymentMode,
            reference: input.reference,
            amount: toDecimal128(amount),
            taxRatePercent: input.taxRatePercent,
            interState: input.interState,
            cgstAmount: toDecimal128(cgst),
            sgstAmount: toDecimal128(sgst),
            igstAmount: toDecimal128(igst),
            totalAmount: toDecimal128(total),
            notes: input.notes,
            status: "POSTED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      await postAccountVoucher({
        businessId: ctx.businessId,
        branchId,
        financialYear,
        userId: ctx.userId,
        voucherType: "PAYMENT",
        voucherDate: created.expenseDate,
        entries: [
          { accountId: head._id, debit: amount, narration: input.payee },
          ...(gstAccounts && cgst.gt(0) ? [{ accountId: gstAccounts.get("INPUT_CGST")!._id, debit: cgst }] : []),
          ...(gstAccounts && sgst.gt(0) ? [{ accountId: gstAccounts.get("INPUT_SGST")!._id, debit: sgst }] : []),
          ...(gstAccounts && igst.gt(0) ? [{ accountId: gstAccounts.get("INPUT_IGST")!._id, debit: igst }] : []),
          { accountId: from._id, credit: total },
        ],
        narration: `Expense ${formatted}${input.payee ? ` — ${input.payee}` : ""}`,
        referenceNumber: input.reference,
        source: { type: "expenses", id: created._id, number: formatted },
        session,
      });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "expenses",
    documentType: "Expense",
    documentId: created._id,
    newValue: { expenseNumber: created.expenseNumber, total: total.toFixed(2) },
  });
  return serializeDoc(created);
}

export async function cancelExpense(id: string, reason: string | undefined, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Expense not found");
  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);
  const session = await mongoose.startSession();
  let doc: AnyDoc;
  try {
    await session.withTransaction(async () => {
      doc = await Expense.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      if (!doc) throw AppError.notFound("Expense not found");
      if (doc.status === "CANCELLED") throw AppError.badRequest("This expense is already cancelled", "ALREADY_CANCELLED");
      await reverseAccountVoucher({
        businessId: ctx.businessId,
        branchId,
        financialYear,
        userId: ctx.userId,
        sourceType: "expenses",
        sourceId: doc._id,
        reason,
        session,
      });
      doc.status = "CANCELLED";
      doc.cancelledBy = ctx.userId;
      doc.cancelledAt = new Date();
      doc.cancellationReason = reason;
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CANCEL",
    module: "expenses",
    documentType: "Expense",
    documentId: doc._id,
    reason,
  });
  return serializeDoc(doc);
}

export async function getExpense(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Expense not found");
  const doc = await Expense.findOne({ _id: id, businessId: ctx.businessId }).lean();
  if (!doc) throw AppError.notFound("Expense not found");
  return serializeDoc(doc);
}

export async function listExpenses(params: URLSearchParams, ctx: AuthContext) {
  const q = expenseListSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (q.status) filter.status = q.status;
  if (q.expenseAccountId && Types.ObjectId.isValid(q.expenseAccountId)) filter.expenseAccountId = new Types.ObjectId(q.expenseAccountId);
  if (q.query) {
    const rx = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ expenseNumber: rx }, { payee: rx }, { reference: rx }, { expenseAccountName: rx }, { notes: rx }];
  }
  const range = dayRange(q.fromDate, q.toDate);
  if (range) filter.expenseDate = range;

  const [docs, total, sum] = await Promise.all([
    Expense.find(filter).sort({ expenseDate: -1, createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean(),
    Expense.countDocuments(filter),
    Expense.aggregate([{ $match: { ...filter, status: "POSTED" } }, { $group: { _id: null, total: { $sum: "$totalAmount" } } }]),
  ]);
  return {
    items: docs.map((d) => serializeDoc(d)),
    total,
    page: q.page,
    pageSize: q.pageSize,
    totalAmount: new Decimal(String((sum as AnyDoc[])[0]?.total ?? 0)).toFixed(2),
  };
}

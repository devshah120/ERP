import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { Customer } from "@/models/Customer";
import { Vendor } from "@/models/Vendor";
import { Payment } from "@/models/Payment";
import { SalesInvoice } from "@/models/salesDocuments";
import { PurchaseInvoice } from "@/models/purchaseDocuments";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { tryPostDocument, reverseVoucherFor, receiptEntries, paymentEntries } from "@/lib/accounting/posting";
import type { AuthContext } from "@/lib/auth/context";
import { paymentListSchema, type PaymentCreateInput, type PaymentTypeConfig } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function invoiceModel(type: PaymentTypeConfig) {
  return type.invoiceType === "sales-invoices" ? SalesInvoice : PurchaseInvoice;
}

function partyModel(type: PaymentTypeConfig) {
  return type.partyType === "customer" ? Customer : Vendor;
}

/**
 * Payment status derived from the amounts, never set independently — one
 * rule means the badge on the list, the aging bucket and the collection
 * percentage can never disagree with each other.
 */
export function derivePaymentStatus(
  paid: Decimal,
  grandTotal: Decimal
): "UNPAID" | "PARTIALLY_PAID" | "PAID" {
  if (paid.lte(0)) return "UNPAID";
  // Settled to within half a paise counts as paid, so rounding cannot leave
  // an invoice permanently 0.004 short of closed.
  if (paid.gte(grandTotal.minus("0.005"))) return "PAID";
  return "PARTIALLY_PAID";
}

async function resolveContext(ctx: AuthContext) {
  const [business, financialYear] = await Promise.all([
    Business.findById(ctx.businessId).lean(),
    FinancialYear.findOne({ businessId: ctx.businessId, isCurrent: true }).lean(),
  ]);
  if (!business) throw AppError.notFound("Business not found");
  if (!financialYear) {
    throw AppError.badRequest("No open financial year found for this business", "NO_FINANCIAL_YEAR");
  }
  if (!business.defaultBranchId) {
    throw AppError.badRequest("Business has no default branch configured", "NO_BRANCH");
  }
  return { business, financialYear };
}

/**
 * Invoices with money still outstanding, for the allocation picker.
 * Cancelled and draft invoices are excluded: an unposted invoice carries no
 * receivable, so allowing a receipt against it would invent a balance.
 */
export async function listOutstandingInvoices(
  type: PaymentTypeConfig,
  partyId: string,
  ctx: AuthContext
) {
  if (!Types.ObjectId.isValid(partyId)) throw AppError.badRequest("Invalid party id");

  const model = invoiceModel(type);
  const partyIdField = type.partyType === "customer" ? "customerId" : "vendorId";

  const docs = await model
    .find({
      businessId: ctx.businessId,
      [partyIdField]: new Types.ObjectId(partyId),
      status: { $in: ["POSTED", "PARTIALLY_PAID", "PAID"] },
      paymentStatus: { $ne: "PAID" },
    })
    .sort({ documentDate: 1 })
    .limit(200)
    .lean();

  return docs
    .map((d: AnyDoc) => ({
      id: d._id.toString(),
      documentNumber: d.documentNumber,
      documentDate: d.documentDate?.toISOString(),
      dueDate: d.dueDate?.toISOString() ?? null,
      grandTotal: new Decimal(String(d.totals?.grandTotal ?? 0)).toFixed(2),
      paidAmount: new Decimal(String(d.paidAmount ?? 0)).toFixed(2),
      dueAmount: new Decimal(String(d.dueAmount ?? 0)).toFixed(2),
      paymentStatus: d.paymentStatus ?? "UNPAID",
    }))
    .filter((d) => new Decimal(d.dueAmount).gt(0));
}

/**
 * Records money in/out and settles it against invoices in one transaction:
 * the payment row, each invoice's paid/due amounts and their payment
 * statuses either all land or none do. A half-applied receipt would corrupt
 * the receivable ledger, so there is no non-transactional path.
 */
export async function createPayment(
  type: PaymentTypeConfig,
  input: PaymentCreateInput,
  ctx: AuthContext
) {
  const { business, financialYear } = await resolveContext(ctx);

  const amount = new Decimal(input.amount);
  if (amount.lte(0)) throw AppError.badRequest("Amount must be greater than zero", "INVALID_AMOUNT");

  const party = await partyModel(type)
    .findOne({ _id: input.partyId, businessId: ctx.businessId })
    .lean<AnyDoc>();
  if (!party) throw AppError.badRequest(`${type.partyLabel} not found`, "PARTY_NOT_FOUND");

  // Reject duplicate invoice ids up front — otherwise two allocations to the
  // same invoice would each validate against the full outstanding amount and
  // together overpay it.
  const seen = new Set<string>();
  for (const a of input.allocations) {
    if (seen.has(a.invoiceId)) {
      throw AppError.badRequest("The same invoice is allocated twice", "DUPLICATE_ALLOCATION");
    }
    seen.add(a.invoiceId);
  }

  const allocationTotal = input.allocations.reduce((acc, a) => acc.plus(a.amount), new Decimal(0));
  if (allocationTotal.gt(amount)) {
    throw AppError.badRequest(
      `Allocated ${allocationTotal.toFixed(2)} exceeds the ${type.label.toLowerCase()} amount of ${amount.toFixed(2)}`,
      "OVER_ALLOCATED"
    );
  }

  const model = invoiceModel(type);
  const partyIdField = type.partyType === "customer" ? "customerId" : "vendorId";

  const session = await mongoose.startSession();
  let created: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const allocations: AnyDoc[] = [];

      for (const alloc of input.allocations) {
        const allocAmount = new Decimal(alloc.amount);
        if (allocAmount.lte(0)) {
          throw AppError.badRequest("Allocation amounts must be greater than zero", "INVALID_ALLOCATION");
        }

        const invoice = await model
          .findOne({ _id: alloc.invoiceId, businessId: ctx.businessId })
          .session(session);
        if (!invoice) throw AppError.badRequest(`Invoice ${alloc.invoiceId} not found`, "INVOICE_NOT_FOUND");

        if (invoice[partyIdField].toString() !== input.partyId) {
          throw AppError.badRequest(
            `Invoice ${invoice.documentNumber} does not belong to ${party.name}`,
            "INVOICE_PARTY_MISMATCH"
          );
        }
        if (invoice.status === "CANCELLED" || invoice.status === "DRAFT") {
          throw AppError.badRequest(
            `Invoice ${invoice.documentNumber} is ${invoice.status} and carries no balance`,
            "INVOICE_NOT_POSTED"
          );
        }

        const due = new Decimal(String(invoice.dueAmount ?? 0));
        if (allocAmount.gt(due)) {
          throw AppError.badRequest(
            `Cannot allocate ${allocAmount.toFixed(2)} to ${invoice.documentNumber} — only ${due.toFixed(2)} is outstanding`,
            "OVER_PAYMENT"
          );
        }

        const grandTotal = new Decimal(String(invoice.totals?.grandTotal ?? 0));
        const paid = new Decimal(String(invoice.paidAmount ?? 0)).plus(allocAmount);

        invoice.paidAmount = toDecimal128(paid);
        invoice.dueAmount = toDecimal128(grandTotal.minus(paid));
        invoice.paymentStatus = derivePaymentStatus(paid, grandTotal);
        // The workflow status tracks the same fact, so the status badge and
        // the payment badge cannot tell different stories.
        if (invoice.paymentStatus === "PAID") invoice.status = "PAID";
        else if (invoice.paymentStatus === "PARTIALLY_PAID") invoice.status = "PARTIALLY_PAID";
        await invoice.save({ session });

        allocations.push({
          invoiceType: type.invoiceType,
          invoiceId: invoice._id,
          invoiceNumber: invoice.documentNumber,
          invoiceDate: invoice.documentDate,
          amount: toDecimal128(allocAmount),
        });
      }

      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId: business.defaultBranchId!,
        financialYearId: financialYear._id,
        documentType: type.sequenceType,
        prefix: type.prefix,
        financialYearLabel: financialYear.label,
      });

      const docs = await Payment.create(
        [
          {
            businessId: ctx.businessId,
            branchId: business.defaultBranchId,
            financialYearId: financialYear._id,
            documentNumber: formatted,
            documentDate: input.documentDate ? new Date(input.documentDate) : new Date(),
            direction: type.direction,
            partyType: type.partyType,
            partyId: party._id,
            party: {
              code: party[type.partyType === "customer" ? "customerCode" : "vendorCode"] ?? "—",
              name: party.name,
              gstin: party.gstin,
            },
            mode: input.mode,
            referenceNumber: input.referenceNumber,
            referenceDate: input.referenceDate ? new Date(input.referenceDate) : null,
            notes: input.notes,
            amount: toDecimal128(amount),
            allocatedAmount: toDecimal128(allocationTotal),
            unallocatedAmount: toDecimal128(amount.minus(allocationTotal)),
            allocations,
            status: "CONFIRMED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );
      created = docs[0];

      // Money moving is an accounting event: cash/bank goes up or down, and
      // the receivable/payable it settles comes down. Same transaction as the
      // allocation itself, so the ledger can never disagree with the invoice.
      await tryPostDocument({
        businessId: ctx.businessId,
        userId: ctx.userId,
        voucherType: type.direction === "RECEIPT" ? "RECEIPT" : "PAYMENT",
        voucherDate: created.documentDate,
        entries: type.direction === "RECEIPT" ? receiptEntries(created) : paymentEntries(created),
        narration: `${type.label} ${created.documentNumber} — ${party.name}`,
        referenceNumber: created.documentNumber,
        source: { type: type.key, id: created._id, number: created.documentNumber },
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
    module: type.key,
    documentType: type.key,
    documentId: created!._id,
    newValue: { documentNumber: created!.documentNumber, amount: input.amount },
  });

  return serializeDoc(created!);
}

/**
 * Cancels an entry and gives the money back to the invoices it settled.
 * The row is kept rather than deleted — a receipt that was banked and then
 * reversed is history, not a mistake to erase.
 */
export async function cancelPayment(
  type: PaymentTypeConfig,
  id: string,
  reason: string | undefined,
  ctx: AuthContext
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${type.label} not found`);

  const model = invoiceModel(type);
  const session = await mongoose.startSession();
  let updated: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({
        _id: id,
        businessId: ctx.businessId,
        direction: type.direction,
      }).session(session);
      if (!payment) throw AppError.notFound(`${type.label} not found`);
      if (payment.status === "CANCELLED") {
        throw AppError.badRequest(
          `This ${type.label.toLowerCase()} is already cancelled`,
          "ALREADY_CANCELLED"
        );
      }

      for (const alloc of payment.allocations) {
        const invoice = await model
          .findOne({ _id: alloc.invoiceId, businessId: ctx.businessId })
          .session(session);
        if (!invoice) continue;

        const grandTotal = new Decimal(String(invoice.totals?.grandTotal ?? 0));
        const paid = Decimal.max(
          new Decimal(String(invoice.paidAmount ?? 0)).minus(String(alloc.amount)),
          new Decimal(0)
        );

        invoice.paidAmount = toDecimal128(paid);
        invoice.dueAmount = toDecimal128(grandTotal.minus(paid));
        invoice.paymentStatus = derivePaymentStatus(paid, grandTotal);
        // Roll the workflow status back in step with the money.
        if (invoice.status === "PAID" || invoice.status === "PARTIALLY_PAID") {
          invoice.status = invoice.paymentStatus === "UNPAID" ? "POSTED" : invoice.paymentStatus;
        }
        await invoice.save({ session });
      }

      payment.status = "CANCELLED";
      payment.cancelledBy = ctx.userId;
      payment.cancelledAt = new Date();
      payment.cancellationReason = reason;
      payment.updatedBy = ctx.userId;
      await payment.save({ session });

      await reverseVoucherFor({
        businessId: ctx.businessId,
        userId: ctx.userId,
        sourceType: type.key,
        sourceId: payment._id,
        reason,
        session,
      });

      updated = payment;
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CANCEL",
    module: type.key,
    documentType: type.key,
    documentId: updated!._id,
    reason,
  });

  return serializeDoc(updated!);
}

export async function getPayment(type: PaymentTypeConfig, id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${type.label} not found`);
  const doc = await Payment.findOne({
    _id: id,
    businessId: ctx.businessId,
    direction: type.direction,
  }).lean();
  if (!doc) throw AppError.notFound(`${type.label} not found`);
  return serializeDoc(doc);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listPayments(
  type: PaymentTypeConfig,
  searchParams: URLSearchParams,
  ctx: AuthContext,
  options: { pageSizeOverride?: number } = {}
) {
  const parsed = paymentListSchema.parse(Object.fromEntries(searchParams.entries()));
  const pageSize = options.pageSizeOverride ?? parsed.pageSize;

  const filter: Record<string, unknown> = { businessId: ctx.businessId, direction: type.direction };
  if (parsed.status) filter.status = parsed.status;
  if (parsed.mode) filter.mode = parsed.mode;
  if (parsed.partyName) filter["party.name"] = { $regex: escapeRegex(parsed.partyName), $options: "i" };
  if (parsed.query) {
    const rx = { $regex: escapeRegex(parsed.query), $options: "i" };
    filter.$or = [{ documentNumber: rx }, { "party.name": rx }, { referenceNumber: rx }];
  }
  if (parsed.fromDate || parsed.toDate) {
    const range: Record<string, Date> = {};
    if (parsed.fromDate) range.$gte = new Date(parsed.fromDate);
    if (parsed.toDate) {
      const to = new Date(parsed.toDate);
      to.setHours(23, 59, 59, 999);
      range.$lte = to;
    }
    filter.documentDate = range;
  }

  const skip = (parsed.page - 1) * pageSize;
  const [docs, total] = await Promise.all([
    Payment.find(filter).sort({ documentDate: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    Payment.countDocuments(filter),
  ]);

  return {
    items: docs.map((d) => serializeDoc(d)) as Record<string, unknown>[],
    total,
    page: parsed.page,
    pageSize,
  };
}

export const paymentCancelSchema = z.object({ reason: z.string().trim().max(500).optional() });

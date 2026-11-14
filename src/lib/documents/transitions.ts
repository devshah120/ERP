import mongoose, { Types, type ClientSession } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { postStockMovement, reverseStockMovement } from "@/lib/services/stockService";
import { recordAudit } from "@/lib/services/auditService";
import {
  tryPostDocument,
  reverseVoucherFor,
  salesInvoiceEntries,
  purchaseInvoiceEntries,
  creditNoteEntries,
  debitNoteEntries,
} from "@/lib/accounting/posting";
import { serializeDoc } from "@/lib/resources/serialize";
import { allowedTransitions } from "./workflows";
import { getDocumentDefinition } from "./registry";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function hasPermission(ctx: AuthContext, permission?: string): boolean {
  if (!permission) return true;
  return ctx.permissions.includes("*") || ctx.permissions.includes(permission);
}

/**
 * Propagates fulfilment from a delivery/receipt/invoice back to its source
 * order (sales or purchase): increments the matching order line's
 * delivered/invoiced quantity and recalculates the order's own status. This
 * is what keeps the chain in sync instead of each document living in isolation.
 *
 * `deliveredQty` means "delivered" on the sales side and "received" on the
 * purchase side — same column, mirrored direction of goods.
 */
async function applyFulfilmentToSourceOrder(
  doc: AnyDoc,
  field: "deliveredQty" | "invoicedQty",
  direction: 1 | -1,
  session: ClientSession
) {
  const orderTypes = ["sales-orders", "purchase-orders"];
  const link = (doc.sourceDocuments ?? []).find((s: { docType: string }) =>
    orderTypes.includes(s.docType)
  );
  if (!link) return;

  const orderDef = getDocumentDefinition(link.docType);
  if (!orderDef) return;

  const order = await orderDef.model.findById(link.docId).session(session);
  if (!order) return;

  const isPurchase = link.docType === "purchase-orders";

  for (const line of doc.lines) {
    const orderLine = order.lines.find(
      (ol: AnyDoc) =>
        ol.itemId.toString() === line.itemId.toString() &&
        (ol.variantSku ?? "") === (line.variantSku ?? "")
    );
    if (orderLine) {
      orderLine[field] = Math.max(0, (orderLine[field] ?? 0) + direction * line.quantity);
    }
  }

  const fullyDone = order.lines.every((l: AnyDoc) => (l[field] ?? 0) >= l.quantity);
  const partiallyDone = order.lines.some((l: AnyDoc) => (l[field] ?? 0) > 0);

  // Don't overwrite a terminal order status with a fulfilment-derived one.
  if (!["CANCELLED", "COMPLETED"].includes(order.status)) {
    if (field === "deliveredQty") {
      const full = isPurchase ? "RECEIVED" : "DELIVERED";
      const partial = isPurchase ? "PARTIALLY_RECEIVED" : "PARTIALLY_DELIVERED";
      order.status = fullyDone ? full : partiallyDone ? partial : order.status;
    } else {
      order.status = fullyDone ? "INVOICED" : partiallyDone ? "PARTIALLY_INVOICED" : order.status;
    }
  }

  await order.save({ session });
}

export async function transitionDocument(
  docTypeKey: string,
  id: string,
  toStatus: string,
  reason: string | undefined,
  ctx: AuthContext
) {
  const def = getDocumentDefinition(docTypeKey);
  if (!def) throw AppError.notFound("Unknown document type");
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

  const doc = await def.model.findOne({ _id: id, businessId: ctx.businessId });
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  const rule = allowedTransitions(def.workflow, doc.status).find((t) => t.to === toStatus);
  if (!rule) {
    throw AppError.conflict(
      `Cannot move ${def.label} from ${doc.status} to ${toStatus}`,
      "INVALID_STATUS_TRANSITION"
    );
  }

  if (!hasPermission(ctx, rule.permission)) {
    throw AppError.forbidden(`You do not have permission to ${rule.label.toLowerCase()}`);
  }

  if (rule.requiresReason && !reason?.trim()) {
    throw AppError.badRequest("A reason is required for this action", "REASON_REQUIRED");
  }

  const fromStatus = doc.status;
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      // --- stock side effects -------------------------------------------
      if (def.stock && toStatus === def.stock.atStatus) {
        if (doc.stockPosted) {
          throw AppError.conflict("Stock has already been posted for this document", "ALREADY_POSTED");
        }
        await postStockMovement({
          businessId: ctx.businessId,
          warehouseId: doc.warehouseId,
          movementType: def.stock.movementType,
          direction: def.stock.direction,
          lines: doc.lines.map((l: AnyDoc) => ({
            itemId: l.itemId,
            variantSku: l.variantSku,
            quantity: l.quantity,
            unitCost: l.rate?.toString(),
          })),
          sourceDocumentType: def.key,
          sourceDocumentId: doc._id,
          sourceDocumentNumber: doc.documentNumber,
          userId: ctx.userId,
          session,
        });
        doc.stockPosted = true;

        if (def.stock.direction === "OUT") {
          doc.dispatchedAt = new Date();
        } else {
          doc.receivedAt = new Date();
        }

        // A delivery (stock OUT) and a goods receipt (stock IN) both fulfil
        // their source order; returns move stock without fulfilling anything.
        if (def.fulfilsSourceOrder) {
          await applyFulfilmentToSourceOrder(doc, "deliveredQty", 1, session);
        }
      }

      // Cancelling a document that already moved stock reverses it rather
      // than deleting history (Section 38).
      if (toStatus === "CANCELLED" && doc.stockPosted) {
        await reverseStockMovement({
          businessId: ctx.businessId,
          sourceDocumentType: def.key,
          sourceDocumentId: doc._id,
          sourceDocumentNumber: doc.documentNumber,
          userId: ctx.userId,
          session,
        });
        doc.stockPosted = false;
        if (def.fulfilsSourceOrder) {
          await applyFulfilmentToSourceOrder(doc, "deliveredQty", -1, session);
        }
      }

      // --- invoice posting ----------------------------------------------
      if ((docTypeKey === "sales-invoices" || docTypeKey === "purchase-invoices") && toStatus === "POSTED") {
        doc.postedAt = new Date();
        doc.dueAmount = doc.totals.grandTotal;
        doc.paymentStatus = "UNPAID";
        await applyFulfilmentToSourceOrder(doc, "invoicedQty", 1, session);

        // Posting an invoice is the accounting event: it creates the
        // receivable/payable and the GST liability, in the same transaction.
        await tryPostDocument({
          businessId: ctx.businessId,
          userId: ctx.userId,
          voucherType: docTypeKey === "sales-invoices" ? "SALES" : "PURCHASE",
          voucherDate: doc.documentDate ?? new Date(),
          entries:
            docTypeKey === "sales-invoices" ? salesInvoiceEntries(doc) : purchaseInvoiceEntries(doc),
          narration: `${def.label} ${doc.documentNumber}`,
          referenceNumber: doc.documentNumber,
          source: { type: def.key, id: doc._id, number: doc.documentNumber },
          session,
        });
      }

      if ((docTypeKey === "sales-invoices" || docTypeKey === "purchase-invoices") && toStatus === "CANCELLED" && doc.postedAt) {
        await applyFulfilmentToSourceOrder(doc, "invoicedQty", -1, session);
      }

      if ((docTypeKey === "credit-notes" || docTypeKey === "debit-notes") && toStatus === "ISSUED") {
        doc.issuedAt = new Date();

        // A note reverses part of a sale or purchase, so it gets its own
        // journal entry rather than editing the original invoice's.
        await tryPostDocument({
          businessId: ctx.businessId,
          userId: ctx.userId,
          voucherType: "JOURNAL",
          voucherDate: doc.documentDate ?? new Date(),
          entries: docTypeKey === "credit-notes" ? creditNoteEntries(doc) : debitNoteEntries(doc),
          narration: `${def.label} ${doc.documentNumber}`,
          referenceNumber: doc.documentNumber,
          source: { type: def.key, id: doc._id, number: doc.documentNumber },
          session,
        });
      }

      // --- generic status bookkeeping -----------------------------------
      if (["APPROVED", "CONFIRMED"].includes(toStatus)) {
        doc.approvedBy = ctx.userId;
        doc.approvedAt = new Date();
      }
      if (toStatus === "CANCELLED") {
        doc.cancelledBy = ctx.userId;
        doc.cancelledAt = new Date();
        doc.cancellationReason = reason;

        // Reversed, not deleted: a cancelled invoice whose journal entry just
        // vanished would make last month's trial balance unreproducible.
        await reverseVoucherFor({
          businessId: ctx.businessId,
          userId: ctx.userId,
          sourceType: def.key,
          sourceId: doc._id,
          reason,
          session,
        });
      }
      if (toStatus === "DELIVERED" && docTypeKey === "delivery-challans") {
        doc.deliveredAt = new Date();
      }

      doc.status = toStatus;
      doc.updatedBy = ctx.userId;
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: toStatus === "CANCELLED" ? "CANCEL" : toStatus === "POSTED" ? "POST" : "APPROVE",
    module: `sales.${def.key}`,
    documentType: def.label,
    documentId: doc._id,
    oldValue: { status: fromStatus },
    newValue: { status: toStatus },
    reason,
  });

  return serializeDoc(doc);
}

/**
 * Creates a downstream document from an existing one, carrying the lines
 * forward and recording the link in both directions so the full chain
 * (Quotation → Order → Delivery → Invoice → Return → Credit Note) stays
 * navigable (Section 17/37).
 */
export async function convertDocument(
  fromTypeKey: string,
  id: string,
  toTypeKey: string,
  extra: Record<string, unknown>,
  ctx: AuthContext
) {
  const fromDef = getDocumentDefinition(fromTypeKey);
  const toDef = getDocumentDefinition(toTypeKey);
  if (!fromDef || !toDef) throw AppError.notFound("Unknown document type");

  if (!fromDef.convertsTo.includes(toTypeKey)) {
    throw AppError.badRequest(
      `${fromDef.label} cannot be converted into ${toDef.label}`,
      "INVALID_CONVERSION"
    );
  }

  const source = await fromDef.model.findOne({ _id: id, businessId: ctx.businessId });
  if (!source) throw AppError.notFound(`${fromDef.label} not found`);

  if (["CANCELLED", "REJECTED", "EXPIRED"].includes(source.status)) {
    throw AppError.conflict(
      `A ${source.status.toLowerCase()} ${fromDef.label.toLowerCase()} cannot be converted`,
      "SOURCE_NOT_CONVERTIBLE"
    );
  }

  // Converting a quote is the customer's acceptance, so it only has to have
  // been sent. UNDER_NEGOTIATION / APPROVED are older statuses that still convert.
  if (fromTypeKey === "sales-quotations" && !["SENT", "UNDER_NEGOTIATION", "APPROVED"].includes(source.status)) {
    throw AppError.conflict(
      "Send the quotation to the customer before converting it into a sales order",
      "QUOTATION_NOT_SENT"
    );
  }

  // Checked as an inverse so that a fully-fulfilled/invoiced order falls
  // through to the "nothing outstanding" check below and reports the real
  // reason, rather than a misleading "not confirmed" message.
  const ORDER_TYPES = ["sales-orders", "purchase-orders"];
  if (ORDER_TYPES.includes(fromTypeKey) && ["DRAFT", "PENDING_APPROVAL"].includes(source.status)) {
    throw AppError.conflict(
      `The ${fromDef.label.toLowerCase()} must be confirmed before it can be fulfilled or invoiced`,
      "ORDER_NOT_CONFIRMED"
    );
  }

  // Carry forward only what is still outstanding, so converting twice can't
  // over-deliver/over-receive or over-invoice an order.
  const FULFILMENT_TARGETS = ["delivery-challans", "goods-receipts"];
  const remainingField = FULFILMENT_TARGETS.includes(toTypeKey) ? "deliveredQty" : "invoicedQty";
  const carriedLines = source.lines
    .map((l: AnyDoc) => {
      const already = ORDER_TYPES.includes(fromTypeKey) ? (l[remainingField] ?? 0) : 0;
      const remaining = l.quantity - already;
      return { line: l, remaining };
    })
    .filter((x: { remaining: number }) => x.remaining > 0);

  if (carriedLines.length === 0) {
    throw AppError.badRequest(
      `Nothing left to ${FULFILMENT_TARGETS.includes(toTypeKey) ? "fulfil" : "invoice"} on this order`,
      "NOTHING_OUTSTANDING"
    );
  }

  const { createDocument } = await import("./service");

  const input: Record<string, unknown> = {
    [fromDef.party.idField]: source[fromDef.party.idField].toString(),
    documentDate: new Date().toISOString(),
    shippingCharge: source.totals.shippingCharge?.toString() ?? "0",
    notes: source.notes,
    termsAndConditions: source.termsAndConditions,
    lines: carriedLines.map(({ line, remaining }: { line: AnyDoc; remaining: number }) => ({
      itemId: line.itemId.toString(),
      variantSku: line.variantSku,
      color: line.color,
      size: line.size,
      description: line.description,
      quantity: remaining,
      unitName: line.unitName,
      rate: line.rate.toString(),
      discountPercent: line.discountPercent,
      taxRatePercent: line.taxRatePercent,
    })),
    ...extra,
  };

  const createdRaw = await createDocument(toTypeKey, input as never, ctx);
  const created = createdRaw as Record<string, unknown>;

  // Link the new document back to its source, and the source forward.
  await toDef.model.updateOne(
    { _id: created.id },
    {
      $push: {
        sourceDocuments: {
          docType: fromTypeKey,
          docId: source._id,
          docNumber: source.documentNumber,
        },
      },
    }
  );

  if (fromTypeKey === "sales-quotations") {
    source.status = "CONVERTED";
    source.convertedToOrderId = new Types.ObjectId(String(created.id));
    source.updatedBy = ctx.userId;
    await source.save();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: `sales.${toDef.key}`,
    documentType: toDef.label,
    documentId: new Types.ObjectId(String(created.id)),
    newValue: {
      convertedFrom: `${fromDef.label} ${source.documentNumber}`,
      documentNumber: created.documentNumber,
    },
  });

  return { ...created, sourceDocuments: [{ docType: fromTypeKey, docNumber: source.documentNumber }] };
}

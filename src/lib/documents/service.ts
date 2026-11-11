import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { Item } from "@/models/Item";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { computeLine, computeTotals } from "./totals";
import { determineSupply } from "@/lib/gst/supply";
import { toDecimal128 } from "./decimal128";
import { allowedTransitions, canEdit } from "./workflows";
import { getDocumentDefinition, type DocumentDefinition } from "./registry";
import type { AuthContext } from "@/lib/auth/context";

interface LineInputShape {
  itemId: string;
  variantSku?: string;
  color?: string;
  size?: string;
  description?: string;
  quantity: number;
  unitName?: string;
  rate: string;
  discountPercent?: number;
  discountAmount?: string;
  taxRatePercent?: number;
}

interface DocumentInputShape {
  documentDate?: string;
  /** Either customerId (sales) or vendorId (purchase) — see def.party. */
  customerId?: string;
  vendorId?: string;
  lines: LineInputShape[];
  shippingCharge?: string;
  notes?: string;
  termsAndConditions?: string;
  agentId?: string;
  warehouseId?: string;
  [key: string]: unknown;
}

/** Fields that are derived server-side and must never come from the client. */
const SERVER_OWNED = new Set([
  "documentNumber",
  "status",
  "totals",
  "customer",
  "vendor",
  "intraState",
  "businessId",
  "branchId",
  "financialYearId",
  "sourceDocuments",
  "stockPosted",
  "paidAmount",
  "dueAmount",
  "paymentStatus",
]);

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
 * Builds the priced lines and totals. Rates and quantities come from the
 * client, but every derived amount (discount, tax split, line total, grand
 * total) is recomputed here — the client's arithmetic is never stored.
 */
async function buildLinesAndTotals(
  ctx: AuthContext,
  input: DocumentInputShape,
  intraState: boolean
) {
  const itemIds = input.lines.map((l) => new Types.ObjectId(l.itemId));
  const items = await Item.find({ businessId: ctx.businessId, _id: { $in: itemIds } }).lean();
  const itemMap = new Map(items.map((i) => [i._id.toString(), i]));

  const computed = input.lines.map((line) => {
    const item = itemMap.get(line.itemId);
    if (!item) throw AppError.badRequest(`Item ${line.itemId} not found`, "ITEM_NOT_FOUND");

    // Stock is tracked per variant. Allowing a variant-tracked item onto a
    // document without a SKU would post stock into a phantom "no variant"
    // bucket that can never be sold against — so it's rejected up front.
    if (item.hasVariants && item.variants?.length > 0) {
      if (!line.variantSku) {
        throw AppError.badRequest(
          `"${item.name}" is tracked by size/colour — select a variant for this line`,
          "VARIANT_REQUIRED"
        );
      }
      const known = item.variants.some(
        (v: { sku: string }) => v.sku.toUpperCase() === line.variantSku!.toUpperCase()
      );
      if (!known) {
        throw AppError.badRequest(
          `Variant "${line.variantSku}" does not belong to "${item.name}"`,
          "UNKNOWN_VARIANT"
        );
      }
    }

    const c = computeLine(
      {
        quantity: line.quantity,
        rate: line.rate,
        discountPercent: line.discountPercent,
        discountAmount: line.discountAmount,
        taxRatePercent: line.taxRatePercent,
      },
      intraState
    );

    return {
      line: {
        itemId: item._id,
        itemCode: item.itemCode,
        itemName: item.name,
        variantSku: line.variantSku || undefined,
        color: line.color || undefined,
        size: line.size || undefined,
        description: line.description,
        quantity: line.quantity,
        unitName: line.unitName,
        rate: toDecimal128(computed_rate(line.rate)),
        discountPercent: line.discountPercent ?? 0,
        discountAmount: toDecimal128(c.discountAmount),
        taxRatePercent: line.taxRatePercent ?? 0,
        taxableAmount: toDecimal128(c.taxableAmount),
        cgstAmount: toDecimal128(c.cgstAmount),
        sgstAmount: toDecimal128(c.sgstAmount),
        igstAmount: toDecimal128(c.igstAmount),
        taxAmount: toDecimal128(c.taxAmount),
        lineTotal: toDecimal128(c.lineTotal),
        deliveredQty: 0,
        invoicedQty: 0,
        returnedQty: 0,
      },
      computed: c,
    };
  });

  const totals = computeTotals(
    computed.map((c) => c.computed),
    input.shippingCharge ?? "0"
  );

  return {
    lines: computed.map((c) => c.line),
    totals: {
      subTotal: toDecimal128(totals.subTotal),
      totalDiscount: toDecimal128(totals.totalDiscount),
      taxableAmount: toDecimal128(totals.taxableAmount),
      cgstAmount: toDecimal128(totals.cgstAmount),
      sgstAmount: toDecimal128(totals.sgstAmount),
      igstAmount: toDecimal128(totals.igstAmount),
      totalTax: toDecimal128(totals.totalTax),
      shippingCharge: toDecimal128(totals.shippingCharge),
      roundOff: toDecimal128(totals.roundOff),
      grandTotal: toDecimal128(totals.grandTotal),
    },
    grandTotal: totals.grandTotal,
  };
}

// Small helper so the rate string goes through the same decimal handling.
function computed_rate(rate: string) {
  return computeLine({ quantity: 1, rate }, true).grossAmount;
}

function extraFieldsFrom(def: DocumentDefinition, input: DocumentInputShape) {
  const extras: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SERVER_OWNED.has(key)) continue;
    // The party id is applied explicitly by the caller, not as a generic extra.
    if (["lines", def.party.idField, "documentDate", "shippingCharge"].includes(key)) continue;
    if (value === "" || value === undefined) continue;

    if (key.endsWith("Id")) {
      extras[key] = new Types.ObjectId(String(value));
    } else if (key.endsWith("Date") || key === "validUntil") {
      extras[key] = new Date(String(value));
    } else {
      extras[key] = value;
    }
  }
  return extras;
}

export async function createDocument(docTypeKey: string, input: DocumentInputShape, ctx: AuthContext) {
  const def = getDocumentDefinition(docTypeKey);
  if (!def) throw AppError.notFound("Unknown document type");

  const { business, financialYear } = await resolveContext(ctx);

  const partyId = input[def.party.idField] as string;
  const customer = await def.party.model.findOne({ _id: partyId, businessId: ctx.businessId }).lean();
  if (!customer) throw AppError.badRequest(`${def.party.label} not found`, "PARTY_NOT_FOUND");

  // GST: place of supply decides CGST+SGST (intra-state) vs IGST
  // (inter-state). For goods the place of supply is the delivery
  // destination, so the shipping state takes precedence over billing.
  const supply = determineSupply(
    { gstin: business.gstin, billingState: business.state },
    {
      gstin: customer.gstin,
      shippingState: customer.shippingAddress?.state,
      billingState: customer.billingAddress?.state,
    }
  );

  const { lines, totals, grandTotal } = await buildLinesAndTotals(ctx, input, supply.intraState);

  const { formatted } = await getNextDocumentNumber({
    businessId: ctx.businessId,
    branchId: business.defaultBranchId!,
    financialYearId: financialYear._id,
    documentType: def.sequenceType,
    prefix: def.prefix,
    financialYearLabel: financialYear.label,
  });

  const payload: Record<string, unknown> = {
    businessId: ctx.businessId,
    branchId: business.defaultBranchId,
    financialYearId: financialYear._id,
    documentNumber: formatted,
    documentDate: input.documentDate ? new Date(input.documentDate) : new Date(),
    [def.party.idField]: customer._id,
    [def.party.snapshotField]: {
      code: customer[def.party.codeField],
      name: customer.name,
      gstin: customer.gstin,
      state: customer.billingAddress?.state,
      phone: customer.phone,
      email: customer.email,
    },
    billingAddress: customer.billingAddress,
    shippingAddress: customer.shippingAddress ?? customer.billingAddress,
    intraState: supply.intraState,
    supplyType: supply.supplyType,
    placeOfSupplyCode: supply.placeOfSupplyCode,
    placeOfSupplyName: supply.placeOfSupplyName,
    isUnionTerritory: supply.isUnionTerritory,
    lines,
    totals,
    status: def.workflow.initial,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
    ...extraFieldsFrom(def, input),
  };

  if (docTypeKey === "sales-invoices" || docTypeKey === "purchase-invoices") {
    payload.dueAmount = toDecimal128(grandTotal);
    payload.paymentStatus = "UNPAID";
  }

  const doc = await def.model.create(payload);

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: `sales.${def.key}`,
    documentType: def.label,
    documentId: doc._id,
    newValue: { documentNumber: formatted, grandTotal: grandTotal.toFixed(2) },
  });

  return serializeDoc(doc);
}

export async function updateDocument(
  docTypeKey: string,
  id: string,
  input: DocumentInputShape,
  ctx: AuthContext
) {
  const def = getDocumentDefinition(docTypeKey);
  if (!def) throw AppError.notFound("Unknown document type");

  const doc = await def.model.findOne({ _id: id, businessId: ctx.businessId });
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  if (!canEdit(def.workflow, doc.status)) {
    throw AppError.conflict(
      `${def.label} cannot be edited once it is ${doc.status}`,
      "DOCUMENT_LOCKED"
    );
  }

  const { business } = await resolveContext(ctx);

  const supplyTypeBefore = doc.supplyType;

  const incomingPartyId = input[def.party.idField] as string | undefined;
  if (incomingPartyId && incomingPartyId !== doc[def.party.idField]?.toString()) {
    const party = await def.party.model
      .findOne({ _id: incomingPartyId, businessId: ctx.businessId })
      .lean();
    if (!party) throw AppError.badRequest(`${def.party.label} not found`, "PARTY_NOT_FOUND");

    doc.set(def.party.idField, party._id);
    doc.set(def.party.snapshotField, {
      code: party[def.party.codeField],
      name: party.name,
      gstin: party.gstin,
      state: party.billingAddress?.state,
      phone: party.phone,
      email: party.email,
    });
    doc.billingAddress = party.billingAddress;

    // Changing the party can flip the supply type, so GST is re-determined
    // and the lines are re-priced below with the new CGST/SGST vs IGST split.
    const supply = determineSupply(
      { gstin: business.gstin, billingState: business.state },
      {
        gstin: party.gstin,
        shippingState: party.shippingAddress?.state,
        billingState: party.billingAddress?.state,
      }
    );
    doc.intraState = supply.intraState;
    doc.supplyType = supply.supplyType;
    doc.placeOfSupplyCode = supply.placeOfSupplyCode;
    doc.placeOfSupplyName = supply.placeOfSupplyName;
    doc.isUnionTerritory = supply.isUnionTerritory;
  }

  // Lines must be re-priced when they change, and *also* when the supply type
  // flipped — otherwise a document could keep a CGST/SGST split on its lines
  // while its header says inter-state (or vice versa).
  const supplyTypeChanged = doc.supplyType !== supplyTypeBefore;

  if (input.lines || supplyTypeChanged) {
    const linesInput = input.lines
      ? input
      : {
          ...input,
          // Re-price the stored lines under the new supply type.
          lines: doc.lines.map((l: { itemId: Types.ObjectId; variantSku?: string; color?: string; size?: string; description?: string; quantity: number; unitName?: string; rate: Types.Decimal128; discountPercent: number; taxRatePercent: number }) => ({
            itemId: l.itemId.toString(),
            variantSku: l.variantSku,
            color: l.color,
            size: l.size,
            description: l.description,
            quantity: l.quantity,
            unitName: l.unitName,
            rate: l.rate.toString(),
            discountPercent: l.discountPercent,
            taxRatePercent: l.taxRatePercent,
          })),
        };

    const { lines, totals } = await buildLinesAndTotals(ctx, linesInput, doc.intraState);
    doc.lines = lines;
    doc.totals = totals;
    if (docTypeKey === "sales-invoices" || docTypeKey === "purchase-invoices") {
      doc.dueAmount = totals.grandTotal;
    }
  }

  if (input.documentDate) doc.documentDate = new Date(input.documentDate);

  for (const [key, value] of Object.entries(extraFieldsFrom(def, input))) {
    doc.set(key, value);
  }

  doc.updatedBy = ctx.userId;
  await doc.save();

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: `sales.${def.key}`,
    documentType: def.label,
    documentId: doc._id,
  });

  return serializeDoc(doc);
}

export async function getDocument(docTypeKey: string, id: string, ctx: AuthContext) {
  const def = getDocumentDefinition(docTypeKey);
  if (!def) throw AppError.notFound("Unknown document type");
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

  const doc = await def.model.findOne({ _id: id, businessId: ctx.businessId });
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  const serialized = serializeDoc(doc) as Record<string, unknown>;

  // Surface what the user is allowed to do next, straight from the workflow.
  serialized.availableTransitions = allowedTransitions(def.workflow, doc.status);
  serialized.canEdit = canEdit(def.workflow, doc.status);
  serialized.convertsTo = def.convertsTo;

  return serialized;
}

/**
 * Hard-deletes a document, but only while it is still a draft.
 *
 * Past DRAFT the document has an issued number in an audited sequence, may
 * have posted stock, and may already be referenced by a downstream document.
 * Deleting it would leave a gap in the numbering and orphan those links, so
 * the workflow's Cancel action is the only way out — that reverses stock and
 * fulfilment rather than pretending the document never existed.
 */
export async function deleteDraftDocument(docTypeKey: string, id: string, ctx: AuthContext) {
  const def = getDocumentDefinition(docTypeKey);
  if (!def) throw AppError.notFound("Unknown document type");
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound(`${def.label} not found`);

  const doc = await def.model.findOne({ _id: id, businessId: ctx.businessId });
  if (!doc) throw AppError.notFound(`${def.label} not found`);

  if (doc.status !== "DRAFT") {
    throw AppError.badRequest(
      `${def.label} ${doc.documentNumber} is ${doc.status} and cannot be deleted. Cancel it instead — that reverses any stock and fulfilment it caused, and keeps the audit trail intact.`,
      "NOT_DELETABLE"
    );
  }

  if (doc.sourceDocuments?.length > 0) {
    throw AppError.badRequest(
      `${def.label} ${doc.documentNumber} was created from another document and is linked to it. Cancel it instead of deleting.`,
      "LINKED_DOCUMENT"
    );
  }

  const snapshot = serializeDoc(doc);
  await def.model.deleteOne({ _id: doc._id, businessId: ctx.businessId });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "DELETE",
    module: def.key,
    documentType: def.key,
    documentId: doc._id,
    oldValue: snapshot,
  });

  return { id };
}

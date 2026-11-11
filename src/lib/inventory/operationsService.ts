import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Warehouse } from "@/models/Warehouse";
import { StockTransferRequest, ProductionEntry } from "@/models/operations";
import { ProductionFormula } from "@/models/productionMasters";
import { postStockMovement, reverseStockMovement } from "@/lib/services/stockService";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { unitValuation } from "./valuation";
import { createTransfer, loadItems, currentBalance } from "./stockDocumentService";
import { tryPostDocument, reverseVoucherFor, isAccountingEnabled } from "@/lib/accounting/posting";
import { ensureChartOfAccounts } from "@/lib/accounting/chartOfAccounts";
import { resolveBusinessContext, escapeRegex, dayRange } from "@/lib/services/businessContext";
import { SEQUENCES } from "@/lib/numbering/catalogue";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const lineInput = z.object({
  itemId: z.string().trim().min(1, "Choose an item"),
  variantSku: z.string().trim().optional(),
  quantity: z.coerce.number().positive("Quantity must be more than zero"),
});

async function requireWarehouse(businessId: Types.ObjectId, id: string, label: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest(`${label} not found`, "WAREHOUSE_NOT_FOUND");
  const wh = await Warehouse.findOne({ _id: id, businessId }).lean<AnyDoc>();
  if (!wh) throw AppError.badRequest(`${label} not found`, "WAREHOUSE_NOT_FOUND");
  return wh;
}

async function warehouseNames(businessId: Types.ObjectId, docs: AnyDoc[], keys: string[]) {
  const ids = new Set<string>();
  for (const d of docs) for (const k of keys) if (d[k]) ids.add(d[k].toString());
  const rows = await Warehouse.find({ businessId, _id: { $in: [...ids] } }, { name: 1 }).lean<AnyDoc[]>();
  return new Map(rows.map((w) => [w._id.toString(), w.name as string]));
}

/* ================================================================== */
/* Stock transfer requests                                             */
/* ================================================================== */

export const transferRequestSchema = z.object({
  requestDate: z.string().trim().optional(),
  requiredBy: z.string().trim().optional(),
  fromWarehouseId: z.string().trim().min(1, "Choose the warehouse to request from"),
  toWarehouseId: z.string().trim().min(1, "Choose the warehouse that needs the stock"),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineInput).min(1, "Add at least one item"),
});

export async function createTransferRequest(input: z.infer<typeof transferRequestSchema>, ctx: AuthContext) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw AppError.badRequest("The two warehouses must be different", "SAME_WAREHOUSE");
  }
  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);
  await Promise.all([
    requireWarehouse(ctx.businessId, input.fromWarehouseId, "Supplying warehouse"),
    requireWarehouse(ctx.businessId, input.toWarehouseId, "Requesting warehouse"),
  ]);
  const items = await loadItems(ctx.businessId, input.lines);

  const { formatted } = await getNextDocumentNumber({
    businessId: ctx.businessId,
    branchId,
    financialYearId: financialYear._id,
    documentType: SEQUENCES.STOCK_TRANSFER_REQUEST.documentType,
    prefix: SEQUENCES.STOCK_TRANSFER_REQUEST.defaultPrefix,
    financialYearLabel: financialYear.label,
  });

  const doc = await StockTransferRequest.create({
    businessId: ctx.businessId,
    branchId,
    financialYearId: financialYear._id,
    requestNumber: formatted,
    requestDate: input.requestDate ? new Date(input.requestDate) : new Date(),
    requiredBy: input.requiredBy ? new Date(input.requiredBy) : null,
    fromWarehouseId: new Types.ObjectId(input.fromWarehouseId),
    toWarehouseId: new Types.ObjectId(input.toWarehouseId),
    lines: input.lines.map((l) => {
      const item = items.get(l.itemId)!;
      return { itemId: item._id, itemCode: item.itemCode, itemName: item.name, variantSku: l.variantSku || undefined, quantity: l.quantity };
    }),
    notes: input.notes,
    status: "REQUESTED",
    createdBy: ctx.userId,
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "stock-transfer-requests",
    documentType: "Stock transfer request",
    documentId: doc._id,
    newValue: { requestNumber: formatted },
  });
  return serializeDoc(doc);
}

/**
 * Moves a request along: approve, reject, cancel, or fulfil. Fulfilling
 * raises the actual Stock Transfer for the requested quantities; if that
 * fails (not enough stock) the request stays approved.
 */
export async function actOnTransferRequest(
  id: string,
  action: "approve" | "reject" | "cancel" | "fulfil",
  reason: string | undefined,
  ctx: AuthContext
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Request not found");
  const doc = await StockTransferRequest.findOne({ _id: id, businessId: ctx.businessId });
  if (!doc) throw AppError.notFound("Request not found");

  const allowed: Record<typeof action, string[]> = {
    approve: ["REQUESTED"],
    reject: ["REQUESTED"],
    cancel: ["REQUESTED", "APPROVED"],
    fulfil: ["APPROVED"],
  };
  if (!allowed[action].includes(doc.status)) {
    throw AppError.conflict(`A ${doc.status.toLowerCase()} request cannot be ${action === "fulfil" ? "fulfilled" : `${action}d`}`, "INVALID_STATUS_TRANSITION");
  }
  if ((action === "reject" || action === "cancel") && !reason?.trim()) {
    throw AppError.badRequest("A reason is required", "REASON_REQUIRED");
  }

  if (action === "fulfil") {
    // Claim the request first so two people cannot fulfil it twice.
    const claimed = await StockTransferRequest.findOneAndUpdate(
      { _id: doc._id, businessId: ctx.businessId, status: "APPROVED" },
      { $set: { status: "FULFILLED", fulfilledAt: new Date() } },
      { new: true }
    );
    if (!claimed) throw AppError.conflict("This request was just fulfilled by someone else", "ALREADY_FULFILLED");
    try {
      const transfer = (await createTransfer(
        {
          fromWarehouseId: doc.fromWarehouseId.toString(),
          toWarehouseId: doc.toWarehouseId.toString(),
          notes: `Against request ${doc.requestNumber}${doc.notes ? ` — ${doc.notes}` : ""}`,
          lines: doc.lines.map((l: AnyDoc) => ({ itemId: l.itemId.toString(), variantSku: l.variantSku || undefined, quantity: l.quantity })),
        },
        ctx
      )) as AnyDoc;
      claimed.transferId = new Types.ObjectId(transfer.id);
      claimed.transferNumber = transfer.documentNumber;
      await claimed.save();
      await recordAudit({
        businessId: ctx.businessId,
        userId: ctx.userId,
        action: "UPDATE",
        module: "stock-transfer-requests",
        documentType: "Stock transfer request",
        documentId: doc._id,
        newValue: { status: "FULFILLED", transfer: transfer.documentNumber },
      });
      return serializeDoc(claimed);
    } catch (err) {
      await StockTransferRequest.updateOne({ _id: doc._id }, { $set: { status: "APPROVED", fulfilledAt: null } });
      throw err;
    }
  }

  if (action === "approve") {
    doc.status = "APPROVED";
    doc.approvedBy = ctx.userId;
    doc.approvedAt = new Date();
  } else if (action === "reject") {
    doc.status = "REJECTED";
    doc.rejectionReason = reason;
  } else {
    doc.status = "CANCELLED";
    doc.cancelledBy = ctx.userId;
    doc.cancelledAt = new Date();
    doc.cancellationReason = reason;
  }
  await doc.save();

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: action === "cancel" ? "CANCEL" : action === "approve" ? "APPROVE" : "UPDATE",
    module: "stock-transfer-requests",
    documentType: "Stock transfer request",
    documentId: doc._id,
    newValue: { status: doc.status },
    reason,
  });
  return serializeDoc(doc);
}

/* ================================================================== */
/* Production                                                          */
/* ================================================================== */

export const consumptionSchema = z.object({
  entryDate: z.string().trim().optional(),
  warehouseId: z.string().trim().min(1, "Choose a warehouse"),
  purpose: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineInput).min(1, "Add at least one material"),
});

export const creationSchema = z.object({
  entryDate: z.string().trim().optional(),
  warehouseId: z.string().trim().min(1, "Choose the warehouse components come from"),
  outputWarehouseId: z.string().trim().optional(),
  formulaId: z.string().trim().optional(),
  runs: z.coerce.number().positive().default(1),
  outputItemId: z.string().trim().min(1, "Choose what is being made"),
  outputVariantSku: z.string().trim().optional(),
  outputQuantity: z.coerce.number().positive("Output quantity must be more than zero"),
  processingCost: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineInput).min(1, "Add at least one component"),
});

/** Prices each line at the warehouse's moving-average cost. */
async function costLines(
  businessId: Types.ObjectId,
  warehouseId: string,
  lines: z.infer<typeof lineInput>[],
  session: mongoose.ClientSession
) {
  const items = await loadItems(businessId, lines);
  let total = new Decimal(0);
  const out: AnyDoc[] = [];
  for (const l of lines) {
    const item = items.get(l.itemId)!;
    const bal = await currentBalance(businessId, l.itemId, l.variantSku ?? "", warehouseId, session);
    const unit = unitValuation(bal?.averageCost, item.costPrice);
    const value = unit.times(l.quantity);
    total = total.plus(value);
    out.push({
      itemId: item._id,
      itemCode: item.itemCode,
      itemName: item.name,
      variantSku: l.variantSku || undefined,
      quantity: l.quantity,
      unitCost: toDecimal128(unit),
      value: toDecimal128(value),
      _unit: unit,
    });
  }
  return { lines: out, total };
}

async function nextEntryNumber(ctx: AuthContext, kind: "CREATION" | "CONSUMPTION") {
  const { branchId, financialYear } = await resolveBusinessContext(ctx.businessId);
  const seq = kind === "CREATION" ? SEQUENCES.MATERIAL_CREATION : SEQUENCES.MATERIAL_CONSUMPTION;
  const { formatted } = await getNextDocumentNumber({
    businessId: ctx.businessId,
    branchId,
    financialYearId: financialYear._id,
    documentType: seq.documentType,
    prefix: seq.defaultPrefix,
    financialYearLabel: financialYear.label,
  });
  return { formatted, branchId, financialYear };
}

/** Issues materials out of stock and writes their value off to Materials Consumed. */
export async function createConsumption(input: z.infer<typeof consumptionSchema>, ctx: AuthContext) {
  const warehouse = await requireWarehouse(ctx.businessId, input.warehouseId, "Warehouse");
  // Older workspaces were set up before "Materials Consumed" existed.
  if (await isAccountingEnabled(ctx.businessId)) await ensureChartOfAccounts(ctx.businessId, ctx.userId);
  const { formatted, branchId, financialYear } = await nextEntryNumber(ctx, "CONSUMPTION");

  const session = await mongoose.startSession();
  let created: AnyDoc;
  try {
    await session.withTransaction(async () => {
      const { lines, total } = await costLines(ctx.businessId, input.warehouseId, input.lines, session);
      [created] = await ProductionEntry.create(
        [
          {
            businessId: ctx.businessId,
            branchId,
            financialYearId: financialYear._id,
            kind: "CONSUMPTION",
            entryNumber: formatted,
            entryDate: input.entryDate ? new Date(input.entryDate) : new Date(),
            warehouseId: warehouse._id,
            purpose: input.purpose,
            components: lines.map(({ _unit, ...l }) => l),
            totalValue: toDecimal128(total),
            notes: input.notes,
            status: "POSTED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: warehouse._id,
        movementType: "PRODUCTION_CONSUMPTION",
        direction: "OUT",
        lines: lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, quantity: l.quantity, unitCost: l._unit.toFixed(4) })),
        sourceDocumentType: "material-consumption",
        sourceDocumentId: created._id,
        sourceDocumentNumber: formatted,
        userId: ctx.userId,
        session,
      });

      await tryPostDocument({
        businessId: ctx.businessId,
        userId: ctx.userId,
        voucherType: "JOURNAL",
        voucherDate: created.entryDate,
        entries: [
          { role: "MATERIAL_CONSUMPTION", debit: total },
          { role: "INVENTORY", credit: total },
        ],
        narration: `Material consumption ${formatted}${input.purpose ? ` — ${input.purpose}` : ""}`,
        referenceNumber: formatted,
        source: { type: "material-consumption", id: created._id, number: formatted },
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
    module: "material-consumption",
    documentType: "Material consumption",
    documentId: created._id,
    newValue: { entryNumber: formatted },
  });
  return serializeDoc(created);
}

/**
 * Makes a product from components: components out, output in at their
 * combined cost plus processing cost, in one transaction.
 */
export async function createMaterialCreation(input: z.infer<typeof creationSchema>, ctx: AuthContext) {
  const warehouse = await requireWarehouse(ctx.businessId, input.warehouseId, "Component warehouse");
  const outputWh = input.outputWarehouseId
    ? await requireWarehouse(ctx.businessId, input.outputWarehouseId, "Output warehouse")
    : warehouse;
  const outputItems = await loadItems(ctx.businessId, [{ itemId: input.outputItemId, variantSku: input.outputVariantSku }]);
  const outputItem = outputItems.get(input.outputItemId)!;
  if (input.lines.some((l) => l.itemId === input.outputItemId && (l.variantSku ?? "") === (input.outputVariantSku ?? ""))) {
    throw AppError.badRequest("A product cannot be one of its own components", "SELF_COMPONENT");
  }

  let formula: AnyDoc = null;
  if (input.formulaId) {
    if (!Types.ObjectId.isValid(input.formulaId)) throw AppError.badRequest("Formula not found", "FORMULA_NOT_FOUND");
    formula = await ProductionFormula.findOne({ _id: input.formulaId, businessId: ctx.businessId, deletedAt: null }).lean<AnyDoc>();
    if (!formula) throw AppError.badRequest("Formula not found", "FORMULA_NOT_FOUND");
  }

  let processing = new Decimal(0);
  try {
    processing = new Decimal(input.processingCost || "0");
  } catch {
    throw AppError.badRequest("Processing cost must be a number", "BAD_AMOUNT");
  }
  if (processing.lt(0)) throw AppError.badRequest("Processing cost cannot be negative", "BAD_AMOUNT");

  const { formatted, branchId, financialYear } = await nextEntryNumber(ctx, "CREATION");
  const session = await mongoose.startSession();
  let created: AnyDoc;
  try {
    await session.withTransaction(async () => {
      const { lines, total } = await costLines(ctx.businessId, input.warehouseId, input.lines, session);
      const outputValue = total.plus(processing);
      const outputUnit = outputValue.div(input.outputQuantity);

      [created] = await ProductionEntry.create(
        [
          {
            businessId: ctx.businessId,
            branchId,
            financialYearId: financialYear._id,
            kind: "CREATION",
            entryNumber: formatted,
            entryDate: input.entryDate ? new Date(input.entryDate) : new Date(),
            warehouseId: warehouse._id,
            outputWarehouseId: outputWh._id,
            formulaId: formula?._id ?? null,
            formulaName: formula ? `${formula.formulaCode} · ${formula.name}` : undefined,
            runs: input.runs,
            components: lines.map(({ _unit, ...l }) => l),
            output: {
              itemId: outputItem._id,
              itemCode: outputItem.itemCode,
              itemName: outputItem.name,
              variantSku: input.outputVariantSku || undefined,
              quantity: input.outputQuantity,
              unitCost: toDecimal128(outputUnit),
              value: toDecimal128(outputValue),
            },
            processingCost: toDecimal128(processing),
            totalValue: toDecimal128(outputValue),
            notes: input.notes,
            status: "POSTED",
            createdBy: ctx.userId,
          },
        ],
        { session }
      );

      // Components out first: short stock fails the entry before anything is produced.
      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: warehouse._id,
        movementType: "PRODUCTION_CONSUMPTION",
        direction: "OUT",
        lines: lines.map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, quantity: l.quantity, unitCost: l._unit.toFixed(4) })),
        sourceDocumentType: "material-creation",
        sourceDocumentId: created._id,
        sourceDocumentNumber: formatted,
        userId: ctx.userId,
        session,
      });
      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: outputWh._id,
        movementType: "PRODUCTION_OUTPUT",
        direction: "IN",
        lines: [{ itemId: outputItem._id, variantSku: input.outputVariantSku || undefined, quantity: input.outputQuantity, unitCost: outputUnit.toFixed(4) }],
        sourceDocumentType: "material-creation",
        sourceDocumentId: created._id,
        sourceDocumentNumber: formatted,
        userId: ctx.userId,
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
    module: "material-creation",
    documentType: "Material creation",
    documentId: created._id,
    newValue: { entryNumber: formatted, output: outputItem.name, quantity: input.outputQuantity },
  });
  return serializeDoc(created);
}

/** Cancels a production entry by offsetting its stock (and journal) rows. */
export async function cancelProductionEntry(kind: "CREATION" | "CONSUMPTION", id: string, reason: string | undefined, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Entry not found");
  const sourceType = kind === "CREATION" ? "material-creation" : "material-consumption";
  const session = await mongoose.startSession();
  let doc: AnyDoc;
  try {
    await session.withTransaction(async () => {
      doc = await ProductionEntry.findOne({ _id: id, businessId: ctx.businessId, kind }).session(session);
      if (!doc) throw AppError.notFound("Entry not found");
      if (doc.status === "CANCELLED") throw AppError.badRequest("Already cancelled", "ALREADY_CANCELLED");
      await reverseStockMovement({
        businessId: ctx.businessId,
        sourceDocumentType: sourceType,
        sourceDocumentId: doc._id,
        sourceDocumentNumber: doc.entryNumber,
        userId: ctx.userId,
        session,
      });
      if (kind === "CONSUMPTION") {
        await reverseVoucherFor({ businessId: ctx.businessId, userId: ctx.userId, sourceType, sourceId: doc._id, reason, session });
      }
      doc.status = "CANCELLED";
      doc.cancelledBy = ctx.userId;
      doc.cancelledAt = new Date();
      doc.cancellationReason = reason;
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: sourceType, documentId: doc._id, reason });
  return serializeDoc(doc);
}

/* ================================================================== */
/* Reads                                                               */
/* ================================================================== */

const listSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.string().trim().max(20).optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});

export async function listTransferRequests(params: URLSearchParams, ctx: AuthContext) {
  const q = listSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (q.status) filter.status = q.status;
  if (q.query) filter.requestNumber = { $regex: escapeRegex(q.query), $options: "i" };
  const range = dayRange(q.fromDate, q.toDate);
  if (range) filter.requestDate = range;
  const [docs, total] = await Promise.all([
    StockTransferRequest.find(filter).sort({ requestDate: -1, createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<AnyDoc[]>(),
    StockTransferRequest.countDocuments(filter),
  ]);
  const names = await warehouseNames(ctx.businessId, docs, ["fromWarehouseId", "toWarehouseId"]);
  return {
    items: docs.map((d) => ({
      ...(serializeDoc(d) as AnyDoc),
      fromWarehouseName: names.get(d.fromWarehouseId?.toString()) ?? "—",
      toWarehouseName: names.get(d.toWarehouseId?.toString()) ?? "—",
      totalQuantity: d.lines.reduce((s: number, l: AnyDoc) => s + l.quantity, 0),
    })),
    total,
  };
}

export async function getTransferRequest(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Request not found");
  const doc = await StockTransferRequest.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!doc) throw AppError.notFound("Request not found");
  const names = await warehouseNames(ctx.businessId, [doc], ["fromWarehouseId", "toWarehouseId"]);
  return { ...(serializeDoc(doc) as AnyDoc), fromWarehouseName: names.get(doc.fromWarehouseId.toString()), toWarehouseName: names.get(doc.toWarehouseId.toString()) };
}

export async function listProductionEntries(kind: "CREATION" | "CONSUMPTION", params: URLSearchParams, ctx: AuthContext) {
  const q = listSchema.parse(Object.fromEntries(params.entries()));
  const filter: Record<string, unknown> = { businessId: ctx.businessId, kind };
  if (q.status) filter.status = q.status;
  if (q.query) {
    const rx = { $regex: escapeRegex(q.query), $options: "i" };
    filter.$or = [{ entryNumber: rx }, { "output.itemName": rx }, { purpose: rx }, { formulaName: rx }];
  }
  const range = dayRange(q.fromDate, q.toDate);
  if (range) filter.entryDate = range;
  const [docs, total] = await Promise.all([
    ProductionEntry.find(filter).sort({ entryDate: -1, createdAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean<AnyDoc[]>(),
    ProductionEntry.countDocuments(filter),
  ]);
  const names = await warehouseNames(ctx.businessId, docs, ["warehouseId"]);
  return {
    items: docs.map((d) => ({ ...(serializeDoc(d) as AnyDoc), warehouseName: names.get(d.warehouseId?.toString()) ?? "—" })),
    total,
  };
}

export async function getProductionEntry(kind: "CREATION" | "CONSUMPTION", id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Entry not found");
  const doc = await ProductionEntry.findOne({ _id: id, businessId: ctx.businessId, kind }).lean<AnyDoc>();
  if (!doc) throw AppError.notFound("Entry not found");
  const names = await warehouseNames(ctx.businessId, [doc], ["warehouseId", "outputWarehouseId"]);
  return {
    ...(serializeDoc(doc) as AnyDoc),
    warehouseName: names.get(doc.warehouseId.toString()),
    outputWarehouseName: doc.outputWarehouseId ? names.get(doc.outputWarehouseId.toString()) : undefined,
  };
}

import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { Item } from "@/models/Item";
import { Warehouse } from "@/models/Warehouse";
import { StockBalance } from "@/models/inventory";
import { StockAdjustment, StockTransfer, ADJUSTMENT_REASONS } from "@/models/stockDocuments";
import { postStockMovement, reverseStockMovement } from "@/lib/services/stockService";
import { getNextDocumentNumber } from "@/lib/services/numberingService";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { unitValuation } from "./valuation";
import {
  tryPostDocument,
  reverseVoucherFor,
  stockAdjustmentEntries,
} from "@/lib/accounting/posting";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/* ------------------------------------------------------------------ */
/* Input schemas                                                       */
/* ------------------------------------------------------------------ */

export const adjustmentCreateSchema = z.object({
  documentDate: z.string().trim().optional(),
  warehouseId: z.string().trim().min(1, "Warehouse is required"),
  reason: z.enum(ADJUSTMENT_REASONS).default("PHYSICAL_COUNT"),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        variantSku: z.string().trim().optional(),
        /** The physical count. The difference against the system is derived. */
        countedQuantity: z.coerce.number().min(0),
        note: z.string().trim().max(300).optional(),
      })
    )
    .min(1, "Add at least one item to adjust"),
});
export type AdjustmentCreateInput = z.infer<typeof adjustmentCreateSchema>;

export const transferCreateSchema = z.object({
  documentDate: z.string().trim().optional(),
  fromWarehouseId: z.string().trim().min(1, "Source warehouse is required"),
  toWarehouseId: z.string().trim().min(1, "Destination warehouse is required"),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        variantSku: z.string().trim().optional(),
        quantity: z.coerce.number().positive(),
      })
    )
    .min(1, "Add at least one item to transfer"),
});
export type TransferCreateInput = z.infer<typeof transferCreateSchema>;

export const stockListSchema = z.object({
  query: z.string().trim().max(200).optional(),
  status: z.string().trim().max(20).optional(),
  warehouseId: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
});

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

async function resolveContext(ctx: AuthContext) {
  const [business, financialYear] = await Promise.all([
    Business.findById(ctx.businessId).lean(),
    FinancialYear.findOne({ businessId: ctx.businessId, isCurrent: true }).lean(),
  ]);
  if (!business?.defaultBranchId) throw AppError.badRequest("Business has no default branch", "NO_BRANCH");
  if (!financialYear) throw AppError.badRequest("No open financial year", "NO_FINANCIAL_YEAR");
  return { business, financialYear };
}

async function requireWarehouse(businessId: Types.ObjectId, id: string, label: string) {
  const wh = await Warehouse.findOne({ _id: id, businessId }).lean<AnyDoc>();
  if (!wh) throw AppError.badRequest(`${label} not found`, "WAREHOUSE_NOT_FOUND");
  return wh;
}

/**
 * Loads the items on a document and rejects a variant-tracked item that
 * arrived without a SKU — the same rule the sales and purchase engines apply,
 * so stock cannot be adjusted into an unsellable "no variant" bucket.
 */
export async function loadItems(businessId: Types.ObjectId, lines: { itemId: string; variantSku?: string }[]) {
  const ids = lines.map((l) => new Types.ObjectId(l.itemId));
  const items = await Item.find({ businessId, _id: { $in: ids } }).lean<AnyDoc[]>();
  const map = new Map(items.map((i) => [i._id.toString(), i]));

  for (const line of lines) {
    const item = map.get(line.itemId);
    if (!item) throw AppError.badRequest(`Item ${line.itemId} not found`, "ITEM_NOT_FOUND");

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
  }
  return map;
}

/** Current on-hand balance for one item/variant/warehouse. */
export async function currentBalance(
  businessId: Types.ObjectId,
  itemId: string,
  variantSku: string,
  warehouseId: string,
  session?: mongoose.ClientSession
) {
  return StockBalance.findOne(
    { businessId, itemId: new Types.ObjectId(itemId), variantSku, warehouseId: new Types.ObjectId(warehouseId) },
    null,
    session ? { session } : {}
  ).lean<AnyDoc>();
}

/* ================================================================== */
/* Stock adjustment                                                    */
/* ================================================================== */

/**
 * Records a physical count and moves stock to match it, in one transaction.
 *
 * The user enters what they counted, not a delta — the difference is derived
 * from the live balance at the moment of posting. Asking for a delta invites
 * arithmetic mistakes, and the count is what the person on the warehouse
 * floor actually knows.
 */
export async function createAdjustment(input: AdjustmentCreateInput, ctx: AuthContext) {
  const { business, financialYear } = await resolveContext(ctx);
  const warehouse = await requireWarehouse(ctx.businessId, input.warehouseId, "Warehouse");
  const itemMap = await loadItems(ctx.businessId, input.lines);

  const session = await mongoose.startSession();
  let created: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const lines: AnyDoc[] = [];
      let totalValueChange = new Decimal(0);
      const movementsIn: AnyDoc[] = [];
      const movementsOut: AnyDoc[] = [];

      for (const line of input.lines) {
        const item = itemMap.get(line.itemId)!;
        const variantSku = line.variantSku ?? "";
        const balance = await currentBalance(
          ctx.businessId,
          line.itemId,
          variantSku,
          input.warehouseId,
          session
        );

        const systemQuantity = balance?.quantity ?? 0;
        const difference = Number((line.countedQuantity - systemQuantity).toFixed(3));
        if (difference === 0) continue;

        const unitCost = unitValuation(balance?.averageCost, item.costPrice);
        const valueChange = unitCost.times(difference);
        totalValueChange = totalValueChange.plus(valueChange);

        lines.push({
          itemId: item._id,
          itemCode: item.itemCode,
          itemName: item.name,
          variantSku: line.variantSku || undefined,
          systemQuantity,
          countedQuantity: line.countedQuantity,
          differenceQuantity: difference,
          unitCost: toDecimal128(unitCost),
          valueChange: toDecimal128(valueChange),
          note: line.note,
        });

        const movement = {
          itemId: item._id,
          variantSku: line.variantSku || undefined,
          quantity: Math.abs(difference),
          unitCost: unitCost.toFixed(4),
        };
        if (difference > 0) movementsIn.push(movement);
        else movementsOut.push(movement);
      }

      if (lines.length === 0) {
        throw AppError.badRequest(
          "Every counted quantity already matches the system — there is nothing to adjust.",
          "NO_DIFFERENCE"
        );
      }

      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId: business.defaultBranchId!,
        financialYearId: financialYear._id,
        documentType: "STOCK_ADJUSTMENT",
        prefix: "ADJ",
        financialYearLabel: financialYear.label,
      });

      const docs = await StockAdjustment.create(
        [
          {
            businessId: ctx.businessId,
            branchId: business.defaultBranchId,
            financialYearId: financialYear._id,
            documentNumber: formatted,
            documentDate: input.documentDate ? new Date(input.documentDate) : new Date(),
            warehouseId: warehouse._id,
            reason: input.reason,
            notes: input.notes,
            lines,
            totalValueChange: toDecimal128(totalValueChange),
            status: "POSTED",
            stockPosted: true,
            postedAt: new Date(),
            createdBy: ctx.userId,
          },
        ],
        { session }
      );
      created = docs[0];

      // Damage and wastage keep their own movement types so the stock ledger
      // still distinguishes "we lost it" from "we miscounted it".
      const movementType =
        input.reason === "DAMAGE" ? "DAMAGE" : input.reason === "WASTAGE" ? "WASTAGE" : "STOCK_ADJUSTMENT";

      if (movementsIn.length > 0) {
        await postStockMovement({
          businessId: ctx.businessId,
          warehouseId: warehouse._id,
          movementType,
          direction: "IN",
          lines: movementsIn,
          sourceDocumentType: "stock-adjustments",
          sourceDocumentId: created._id,
          sourceDocumentNumber: formatted,
          userId: ctx.userId,
          session,
        });
      }
      if (movementsOut.length > 0) {
        await postStockMovement({
          businessId: ctx.businessId,
          warehouseId: warehouse._id,
          movementType,
          direction: "OUT",
          lines: movementsOut,
          sourceDocumentType: "stock-adjustments",
          sourceDocumentId: created._id,
          sourceDocumentNumber: formatted,
          userId: ctx.userId,
          // A count can legitimately find less than the system believed, and
          // refusing that would make the system unfixable.
          allowNegative: true,
          session,
        });
      }

      await tryPostDocument({
        businessId: ctx.businessId,
        userId: ctx.userId,
        voucherType: "JOURNAL",
        voucherDate: created.documentDate,
        entries: stockAdjustmentEntries(totalValueChange),
        narration: `Stock adjustment ${formatted} (${input.reason.toLowerCase().replace("_", " ")})`,
        referenceNumber: formatted,
        source: { type: "stock-adjustments", id: created._id, number: formatted },
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
    module: "stock-adjustments",
    documentType: "stock-adjustments",
    documentId: created!._id,
    newValue: { documentNumber: created!.documentNumber, lines: created!.lines.length },
  });

  return serializeDoc(created!);
}

/* ================================================================== */
/* Stock transfer                                                      */
/* ================================================================== */

/**
 * Moves stock between two of the business's own warehouses.
 *
 * Writes a matched OUT and IN pair in one transaction, so stock is never in
 * flight — it cannot be missing from both ends or counted at both. No journal
 * entry is posted: the goods never left the business.
 */
export async function createTransfer(input: TransferCreateInput, ctx: AuthContext) {
  if (input.fromWarehouseId === input.toWarehouseId) {
    throw AppError.badRequest("Source and destination warehouses must be different", "SAME_WAREHOUSE");
  }

  const { business, financialYear } = await resolveContext(ctx);
  const [from, to] = await Promise.all([
    requireWarehouse(ctx.businessId, input.fromWarehouseId, "Source warehouse"),
    requireWarehouse(ctx.businessId, input.toWarehouseId, "Destination warehouse"),
  ]);
  const itemMap = await loadItems(ctx.businessId, input.lines);

  const session = await mongoose.startSession();
  let created: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const lines: AnyDoc[] = [];
      let totalQuantity = 0;

      for (const line of input.lines) {
        const item = itemMap.get(line.itemId)!;
        const variantSku = line.variantSku ?? "";
        const balance = await currentBalance(
          ctx.businessId,
          line.itemId,
          variantSku,
          input.fromWarehouseId,
          session
        );
        const unitCost = unitValuation(balance?.averageCost, item.costPrice);

        lines.push({
          itemId: item._id,
          itemCode: item.itemCode,
          itemName: item.name,
          variantSku: line.variantSku || undefined,
          quantity: line.quantity,
          unitCost: toDecimal128(unitCost),
        });
        totalQuantity += line.quantity;
      }

      const { formatted } = await getNextDocumentNumber({
        businessId: ctx.businessId,
        branchId: business.defaultBranchId!,
        financialYearId: financialYear._id,
        documentType: "STOCK_TRANSFER",
        prefix: "TRF",
        financialYearLabel: financialYear.label,
      });

      const docs = await StockTransfer.create(
        [
          {
            businessId: ctx.businessId,
            branchId: business.defaultBranchId,
            financialYearId: financialYear._id,
            documentNumber: formatted,
            documentDate: input.documentDate ? new Date(input.documentDate) : new Date(),
            fromWarehouseId: from._id,
            toWarehouseId: to._id,
            notes: input.notes,
            lines,
            totalQuantity: Number(totalQuantity.toFixed(3)),
            status: "COMPLETED",
            stockPosted: true,
            completedAt: new Date(),
            createdBy: ctx.userId,
          },
        ],
        { session }
      );
      created = docs[0];

      const movementLines = lines.map((l: AnyDoc) => ({
        itemId: l.itemId,
        variantSku: l.variantSku,
        quantity: l.quantity,
        unitCost: l.unitCost.toString(),
      }));

      // OUT first: if the source does not have the stock, the whole transfer
      // fails before anything is credited to the destination.
      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: from._id,
        movementType: "STOCK_TRANSFER_OUT",
        direction: "OUT",
        lines: movementLines,
        sourceDocumentType: "stock-transfers",
        sourceDocumentId: created._id,
        sourceDocumentNumber: formatted,
        userId: ctx.userId,
        session,
      });

      await postStockMovement({
        businessId: ctx.businessId,
        warehouseId: to._id,
        movementType: "STOCK_TRANSFER_IN",
        direction: "IN",
        lines: movementLines,
        sourceDocumentType: "stock-transfers",
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
    module: "stock-transfers",
    documentType: "stock-transfers",
    documentId: created!._id,
    newValue: { documentNumber: created!.documentNumber, quantity: created!.totalQuantity },
  });

  return serializeDoc(created!);
}

/* ================================================================== */
/* Cancellation, read and list                                         */
/* ================================================================== */

/**
 * Cancels a stock document by writing offsetting ledger rows, never by
 * deleting history — the same rule the sales and purchase chains follow.
 */
export async function cancelStockDocument(
  kind: "stock-adjustments" | "stock-transfers",
  id: string,
  reason: string | undefined,
  ctx: AuthContext
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Document not found");
  const model = kind === "stock-adjustments" ? StockAdjustment : StockTransfer;

  const session = await mongoose.startSession();
  let updated: AnyDoc;

  try {
    await session.withTransaction(async () => {
      const doc = await model.findOne({ _id: id, businessId: ctx.businessId }).session(session);
      if (!doc) throw AppError.notFound("Document not found");
      if (doc.status === "CANCELLED") {
        throw AppError.badRequest("This document is already cancelled", "ALREADY_CANCELLED");
      }

      if (doc.stockPosted) {
        await reverseStockMovement({
          businessId: ctx.businessId,
          sourceDocumentType: kind,
          sourceDocumentId: doc._id,
          sourceDocumentNumber: doc.documentNumber,
          userId: ctx.userId,
          session,
        });
        doc.stockPosted = false;
      }

      if (kind === "stock-adjustments") {
        await reverseVoucherFor({
          businessId: ctx.businessId,
          userId: ctx.userId,
          sourceType: kind,
          sourceId: doc._id,
          reason,
          session,
        });
      }

      doc.status = "CANCELLED";
      doc.cancelledBy = ctx.userId;
      doc.cancelledAt = new Date();
      doc.cancellationReason = reason;
      doc.updatedBy = ctx.userId;
      await doc.save({ session });
      updated = doc;
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CANCEL",
    module: kind,
    documentType: kind,
    documentId: updated!._id,
    reason,
  });

  return serializeDoc(updated!);
}

export async function getStockDocument(
  kind: "stock-adjustments" | "stock-transfers",
  id: string,
  ctx: AuthContext
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Document not found");
  const model = kind === "stock-adjustments" ? StockAdjustment : StockTransfer;
  const doc = await model.findOne({ _id: id, businessId: ctx.businessId }).lean();
  if (!doc) throw AppError.notFound("Document not found");
  return serializeDoc(doc);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function listStockDocuments(
  kind: "stock-adjustments" | "stock-transfers",
  searchParams: URLSearchParams,
  ctx: AuthContext,
  options: { pageSizeOverride?: number } = {}
) {
  const parsed = stockListSchema.parse(Object.fromEntries(searchParams.entries()));
  const pageSize = options.pageSizeOverride ?? parsed.pageSize;
  const model = kind === "stock-adjustments" ? StockAdjustment : StockTransfer;

  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (parsed.status) filter.status = parsed.status;
  if (parsed.query) filter.documentNumber = { $regex: escapeRegex(parsed.query), $options: "i" };
  if (parsed.warehouseId) {
    filter.$or =
      kind === "stock-adjustments"
        ? [{ warehouseId: parsed.warehouseId }]
        : [{ fromWarehouseId: parsed.warehouseId }, { toWarehouseId: parsed.warehouseId }];
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
    model.find(filter).sort({ documentDate: -1, createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    model.countDocuments(filter),
  ]);

  // Warehouse names are resolved here so the list does not have to.
  const whIds = new Set<string>();
  for (const d of docs as AnyDoc[]) {
    for (const key of ["warehouseId", "fromWarehouseId", "toWarehouseId"]) {
      if (d[key]) whIds.add(d[key].toString());
    }
  }
  const warehouses = await Warehouse.find(
    { businessId: ctx.businessId, _id: { $in: [...whIds] } },
    { name: 1 }
  ).lean();
  const whName = new Map(warehouses.map((w) => [w._id.toString(), w.name]));

  return {
    items: (docs as AnyDoc[]).map((d) => {
      const row = serializeDoc(d) as Record<string, unknown>;
      if (d.warehouseId) row.warehouseName = whName.get(d.warehouseId.toString()) ?? "—";
      if (d.fromWarehouseId) row.fromWarehouseName = whName.get(d.fromWarehouseId.toString()) ?? "—";
      if (d.toWarehouseId) row.toWarehouseName = whName.get(d.toWarehouseId.toString()) ?? "—";
      row.lineCount = d.lines?.length ?? 0;
      return row;
    }),
    total,
    page: parsed.page,
    pageSize,
  };
}

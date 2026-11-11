import { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { InventoryTransaction, StockBalance, type MovementType } from "@/models/inventory";
import { AppError } from "@/lib/errors/AppError";

export interface StockMovementLine {
  itemId: Types.ObjectId;
  variantSku?: string;
  quantity: number; // always positive; direction comes from movement type
  unitCost?: string;
}

export interface PostStockParams {
  businessId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  movementType: MovementType;
  direction: "IN" | "OUT";
  lines: StockMovementLine[];
  sourceDocumentType: string;
  sourceDocumentId: Types.ObjectId;
  sourceDocumentNumber: string;
  userId: Types.ObjectId;
  allowNegative?: boolean;
  session: ClientSession;
}

/**
 * Writes ledger rows and updates cached balances for one document, inside the
 * caller's transaction. Never called outside a transaction: the ledger and the
 * balance must move together or not at all (Section 24 / decision J-8).
 */
export async function postStockMovement(params: PostStockParams): Promise<void> {
  const {
    businessId,
    warehouseId,
    movementType,
    direction,
    lines,
    sourceDocumentType,
    sourceDocumentId,
    sourceDocumentNumber,
    userId,
    allowNegative = false,
    session,
  } = params;

  const sign = direction === "IN" ? 1 : -1;

  for (const line of lines) {
    if (line.quantity <= 0) continue;
    const variantSku = line.variantSku ?? "";

    const balance = await StockBalance.findOne(
      { businessId, itemId: line.itemId, variantSku, warehouseId },
      null,
      { session }
    );

    const currentQty = balance?.quantity ?? 0;
    const nextQty = currentQty + sign * line.quantity;

    if (!allowNegative && nextQty < 0) {
      throw AppError.badRequest(
        `Insufficient stock: ${variantSku || "item"} has ${currentQty} available but ${line.quantity} required`,
        "INSUFFICIENT_STOCK"
      );
    }

    await InventoryTransaction.create(
      [
        {
          businessId,
          itemId: line.itemId,
          variantSku: variantSku || undefined,
          warehouseId,
          movementType,
          quantity: sign * line.quantity,
          unitCost: line.unitCost ?? "0",
          sourceDocumentType,
          sourceDocumentId,
          sourceDocumentNumber,
          userId,
        },
      ],
      { session }
    );

    await StockBalance.updateOne(
      { businessId, itemId: line.itemId, variantSku, warehouseId },
      {
        $inc: { quantity: sign * line.quantity },
        $set: {
          averageCost: nextAverageCost({
            currentQty,
            currentAverage: balance?.averageCost?.toString() ?? "0",
            direction,
            quantity: line.quantity,
            unitCost: line.unitCost ?? "0",
          }),
        },
      },
      { upsert: true, session }
    );
  }
}

/**
 * Moving-average cost, recomputed on every receipt.
 *
 * Goods coming in blend their cost into the average; goods going out leave it
 * alone, because issuing stock does not change what the remaining stock cost.
 * This is what makes stock valuation meaningful — without it the cached
 * average stays at its default and every valuation reads as zero.
 *
 * Exported for direct unit testing: the arithmetic matters more than the
 * database plumbing around it.
 */
export function nextAverageCost(params: {
  currentQty: number;
  currentAverage: string;
  direction: "IN" | "OUT";
  quantity: number;
  unitCost: string;
}): Types.Decimal128 {
  const current = new Decimal(params.currentAverage || "0");

  // Issues do not revalue what is left on the shelf.
  if (params.direction === "OUT") return Types.Decimal128.fromString(current.toFixed(4));

  const incoming = new Decimal(params.unitCost || "0");

  // Receiving against a negative balance means the earlier issue was never
  // costed. Blending into it would produce a meaningless average, so the
  // incoming cost simply becomes the new basis.
  if (params.currentQty <= 0) return Types.Decimal128.fromString(incoming.toFixed(4));

  const totalQty = new Decimal(params.currentQty).plus(params.quantity);
  if (totalQty.lte(0)) return Types.Decimal128.fromString(incoming.toFixed(4));

  const blended = current
    .times(params.currentQty)
    .plus(incoming.times(params.quantity))
    .div(totalQty);

  // Four decimal places: unit costs on garment lines are routinely finer than
  // two, and rounding here would compound across every receipt.
  return Types.Decimal128.fromString(blended.toFixed(4));
}

/**
 * Reverses every ledger row previously written for a document — used when a
 * dispatched delivery or received return is cancelled. Posted stock is never
 * deleted; it is offset by opposite entries so history stays intact
 * (Section 38).
 */
export async function reverseStockMovement(params: {
  businessId: Types.ObjectId;
  sourceDocumentType: string;
  sourceDocumentId: Types.ObjectId;
  sourceDocumentNumber: string;
  userId: Types.ObjectId;
  session: ClientSession;
}): Promise<void> {
  const { businessId, sourceDocumentType, sourceDocumentId, sourceDocumentNumber, userId, session } = params;

  const original = await InventoryTransaction.find(
    { businessId, sourceDocumentType, sourceDocumentId },
    null,
    { session }
  );

  for (const row of original) {
    await InventoryTransaction.create(
      [
        {
          businessId,
          itemId: row.itemId,
          variantSku: row.variantSku,
          warehouseId: row.warehouseId,
          movementType: row.movementType,
          quantity: -row.quantity,
          unitCost: row.unitCost,
          sourceDocumentType: `${sourceDocumentType}_REVERSAL`,
          sourceDocumentId,
          sourceDocumentNumber,
          userId,
        },
      ],
      { session }
    );

    await StockBalance.updateOne(
      {
        businessId,
        itemId: row.itemId,
        variantSku: row.variantSku ?? "",
        warehouseId: row.warehouseId,
      },
      { $inc: { quantity: -row.quantity } },
      { upsert: true, session }
    );
  }
}

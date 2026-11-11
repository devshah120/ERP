import { Types } from "mongoose";
import Decimal from "decimal.js";
import { StockBalance, InventoryTransaction } from "@/models/inventory";
import { Item } from "@/models/Item";
import type { ResolvedPeriod } from "./period";
import { dec, num, type RankedRow } from "./queries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

export interface StockSummary {
  /** Distinct items with a stock row (any warehouse). */
  trackedItems: number;
  totalQuantity: number;
  /** Quantity × average cost — what the stock is worth at what it cost. */
  totalValue: string;
  outOfStockCount: number;
  lowStockCount: number;
  negativeCount: number;
}

/**
 * Stock valuation, on the same basis as the Stock Summary report — see
 * `unitValuation`. The two must agree, so both go through that one helper
 * rather than each picking a cost field.
 */
export async function stockSummary(businessId: Types.ObjectId): Promise<StockSummary> {
  const rows = await StockBalance.aggregate([
    { $match: { businessId } },
    {
      $lookup: {
        from: Item.collection.name,
        localField: "itemId",
        foreignField: "_id",
        as: "item",
      },
    },
    { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
    {
      // The same rule as `unitValuation`, expressed in the aggregation so the
      // whole valuation is one database round-trip.
      $addFields: {
        __unit: {
          $cond: [{ $gt: ["$averageCost", 0] }, "$averageCost", { $ifNull: ["$item.costPrice", 0] }],
        },
      },
    },
    {
      // Rounded per stock row before summing, exactly as the Stock Summary
      // report does — otherwise the two screens differ by stray paise.
      $addFields: { __rowValue: { $round: [{ $multiply: ["$__unit", "$quantity"] }, 2] } },
    },
    {
      $group: {
        _id: "$itemId",
        quantity: { $sum: "$quantity" },
        value: { $sum: "$__rowValue" },
        reorderLevel: { $max: { $ifNull: ["$item.reorderLevel", 0] } },
        minStock: { $max: { $ifNull: ["$item.minStock", 0] } },
      },
    },
  ]);

  let totalQuantity = 0;
  let totalValue = new Decimal(0);
  let outOfStock = 0;
  let lowStock = 0;
  let negative = 0;

  for (const r of rows as AnyDoc[]) {
    totalQuantity += r.quantity;
    totalValue = totalValue.plus(String(r.value ?? 0));
    const threshold = Math.max(r.reorderLevel ?? 0, r.minStock ?? 0);
    if (r.quantity < 0) negative += 1;
    else if (r.quantity === 0) outOfStock += 1;
    // Low stock only counts items that actually declared a threshold —
    // otherwise every item with 0 configured would be flagged forever.
    else if (threshold > 0 && r.quantity <= threshold) lowStock += 1;
  }

  return {
    trackedItems: rows.length,
    totalQuantity: Number(totalQuantity.toFixed(3)),
    totalValue: totalValue.toFixed(2),
    outOfStockCount: outOfStock,
    lowStockCount: lowStock,
    negativeCount: negative,
  };
}

export interface StockAlertRow {
  id: string;
  name: string;
  itemCode: string;
  quantity: number;
  threshold: number;
}

/** Items at or below their reorder level, worst first. */
export async function lowStockItems(businessId: Types.ObjectId, limit = 8): Promise<StockAlertRow[]> {
  const rows = await StockBalance.aggregate([
    { $match: { businessId } },
    { $group: { _id: "$itemId", quantity: { $sum: "$quantity" } } },
    { $lookup: { from: Item.collection.name, localField: "_id", foreignField: "_id", as: "item" } },
    { $unwind: "$item" },
    {
      $project: {
        quantity: 1,
        name: "$item.name",
        itemCode: "$item.itemCode",
        threshold: { $max: [{ $ifNull: ["$item.reorderLevel", 0] }, { $ifNull: ["$item.minStock", 0] }] },
      },
    },
    { $match: { threshold: { $gt: 0 }, $expr: { $lte: ["$quantity", "$threshold"] } } },
    { $sort: { quantity: 1 } },
    { $limit: limit },
  ]);

  return (rows as AnyDoc[]).map((r) => ({
    id: r._id.toString(),
    name: r.name,
    itemCode: r.itemCode,
    quantity: r.quantity,
    threshold: r.threshold,
  }));
}

export interface MovementSummary {
  inQuantity: number;
  outQuantity: number;
}

/** Stock in vs stock out over the period, straight from the ledger. */
export async function stockMovement(
  businessId: Types.ObjectId,
  period: ResolvedPeriod
): Promise<MovementSummary> {
  const rows = await InventoryTransaction.aggregate([
    { $match: { businessId, createdAt: { $gte: period.from, $lte: period.to } } },
    {
      $group: {
        _id: { $cond: [{ $gt: ["$quantity", 0] }, "IN", "OUT"] },
        quantity: { $sum: "$quantity" },
      },
    },
  ]);

  let inQty = 0;
  let outQty = 0;
  for (const r of rows as AnyDoc[]) {
    if (r._id === "IN") inQty = r.quantity;
    else outQty = Math.abs(r.quantity);
  }
  return { inQuantity: Number(inQty.toFixed(3)), outQuantity: Number(outQty.toFixed(3)) };
}

/**
 * Fast and slow movers by quantity issued in the period. Ranked on
 * outbound movement only — a receipt is not evidence that anything sells.
 */
export async function movers(
  businessId: Types.ObjectId,
  period: ResolvedPeriod,
  order: "fast" | "slow",
  limit = 5
): Promise<RankedRow[]> {
  const rows = await InventoryTransaction.aggregate([
    {
      $match: {
        businessId,
        createdAt: { $gte: period.from, $lte: period.to },
        movementType: "SALES_DELIVERY",
      },
    },
    { $group: { _id: "$itemId", quantity: { $sum: { $abs: "$quantity" } }, moves: { $sum: 1 } } },
    { $sort: { quantity: order === "fast" ? -1 : 1 } },
    { $limit: limit },
    { $lookup: { from: Item.collection.name, localField: "_id", foreignField: "_id", as: "item" } },
    { $unwind: { path: "$item", preserveNullAndEmptyArrays: true } },
  ]);

  return (rows as AnyDoc[]).map((r) => ({
    id: r._id.toString(),
    name: r.item?.name ?? "—",
    count: r.moves,
    quantity: num(r.quantity),
    value: dec(0),
  }));
}

import { Schema, model, models, Types } from "mongoose";

export const MOVEMENT_TYPES = [
  "OPENING_STOCK",
  "PURCHASE_RECEIPT",
  "SALES_DELIVERY",
  "SALES_RETURN",
  "PURCHASE_RETURN",
  "STOCK_TRANSFER_OUT",
  "STOCK_TRANSFER_IN",
  "STOCK_ADJUSTMENT",
  "DAMAGE",
  "WASTAGE",
  "PRODUCTION_CONSUMPTION",
  "PRODUCTION_OUTPUT",
  "POS_SALE",
  "POS_RETURN",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/**
 * Append-only stock ledger — the system of record for inventory (Section 24).
 * Every stock-changing document writes rows here inside the same transaction
 * that updates StockBalance, so the cached balance can always be rebuilt
 * from this collection.
 */
export interface IInventoryTransaction {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  itemId: Types.ObjectId;
  variantSku?: string;
  warehouseId: Types.ObjectId;

  movementType: MovementType;
  /** Signed: positive = stock in, negative = stock out. */
  quantity: number;
  unitCost: Types.Decimal128;

  sourceDocumentType: string;
  sourceDocumentId: Types.ObjectId;
  sourceDocumentNumber: string;

  userId?: Types.ObjectId | null;
  createdAt: Date;
}

const inventoryTransactionSchema = new Schema<IInventoryTransaction>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    variantSku: { type: String },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },

    movementType: { type: String, enum: MOVEMENT_TYPES, required: true },
    quantity: { type: Number, required: true },
    unitCost: { type: Schema.Types.Decimal128, required: true, default: "0" },

    sourceDocumentType: { type: String, required: true },
    sourceDocumentId: { type: Schema.Types.ObjectId, required: true },
    sourceDocumentNumber: { type: String, required: true },

    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

inventoryTransactionSchema.index({ businessId: 1, itemId: 1, variantSku: 1, warehouseId: 1, createdAt: 1 });
inventoryTransactionSchema.index({ businessId: 1, sourceDocumentType: 1, sourceDocumentId: 1 });

export const InventoryTransaction =
  models.InventoryTransaction ??
  model<IInventoryTransaction>("InventoryTransaction", inventoryTransactionSchema);

/**
 * Cached current stock per item/variant/warehouse. Derived from the ledger
 * above and updated atomically alongside it — never written independently.
 */
export interface IStockBalance {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  itemId: Types.ObjectId;
  variantSku: string; // "" when the item has no variants
  warehouseId: Types.ObjectId;
  quantity: number;
  /** Soft allocation from confirmed sales orders; available = quantity - reservedQty. */
  reservedQty: number;
  averageCost: Types.Decimal128;
  updatedAt: Date;
}

const stockBalanceSchema = new Schema<IStockBalance>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    variantSku: { type: String, required: true, default: "" },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    quantity: { type: Number, required: true, default: 0 },
    reservedQty: { type: Number, required: true, default: 0 },
    averageCost: { type: Schema.Types.Decimal128, required: true, default: "0" },
  },
  { timestamps: { createdAt: false, updatedAt: true } }
);

stockBalanceSchema.index(
  { businessId: 1, itemId: 1, variantSku: 1, warehouseId: 1 },
  { unique: true }
);

export const StockBalance = models.StockBalance ?? model<IStockBalance>("StockBalance", stockBalanceSchema);

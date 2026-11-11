import { Schema, model, models, Types } from "mongoose";

/**
 * Why stock was adjusted. The reason drives which movement type is written to
 * the inventory ledger, so a damage write-off and a count correction stay
 * distinguishable in the stock ledger forever.
 */
export const ADJUSTMENT_REASONS = [
  "PHYSICAL_COUNT",
  "DAMAGE",
  "WASTAGE",
  "OPENING_STOCK",
  "CORRECTION",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface IStockAdjustmentLine {
  itemId: Types.ObjectId;
  itemCode: string;
  itemName: string;
  variantSku?: string;
  /** Balance at the moment the adjustment was posted, kept for the audit trail. */
  systemQuantity: number;
  countedQuantity: number;
  /** countedQuantity − systemQuantity; signed. */
  differenceQuantity: number;
  unitCost: Types.Decimal128;
  valueChange: Types.Decimal128;
  note?: string;
}

const adjustmentLineSchema = new Schema<IStockAdjustmentLine>(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    variantSku: { type: String },
    systemQuantity: { type: Number, required: true, default: 0 },
    countedQuantity: { type: Number, required: true, default: 0 },
    differenceQuantity: { type: Number, required: true, default: 0 },
    unitCost: { type: Schema.Types.Decimal128, required: true, default: "0" },
    valueChange: { type: Schema.Types.Decimal128, required: true, default: "0" },
    note: { type: String },
  },
  { _id: false }
);

export interface IStockAdjustment {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;

  documentNumber: string;
  documentDate: Date;
  warehouseId: Types.ObjectId;
  reason: AdjustmentReason;
  notes?: string;

  lines: IStockAdjustmentLine[];
  /** Net value effect; positive means stock was found, negative means lost. */
  totalValueChange: Types.Decimal128;

  status: "DRAFT" | "POSTED" | "CANCELLED";
  /** Guards against posting the same adjustment to the ledger twice. */
  stockPosted: boolean;
  postedAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const stockAdjustmentSchema = new Schema<IStockAdjustment>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },

    documentNumber: { type: String, required: true },
    documentDate: { type: Date, required: true, default: () => new Date() },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    reason: { type: String, enum: ADJUSTMENT_REASONS, required: true, default: "PHYSICAL_COUNT" },
    notes: { type: String },

    lines: { type: [adjustmentLineSchema], required: true, default: [] },
    totalValueChange: { type: Schema.Types.Decimal128, required: true, default: "0" },

    status: { type: String, enum: ["DRAFT", "POSTED", "CANCELLED"], required: true, default: "DRAFT" },
    stockPosted: { type: Boolean, required: true, default: false },
    postedAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

stockAdjustmentSchema.index({ businessId: 1, documentNumber: 1 }, { unique: true });
stockAdjustmentSchema.index({ businessId: 1, status: 1, documentDate: -1 });

export const StockAdjustment =
  models.StockAdjustment ?? model<IStockAdjustment>("StockAdjustment", stockAdjustmentSchema);

/* ------------------------------------------------------------------ */
/* Stock transfer                                                      */
/* ------------------------------------------------------------------ */

export interface IStockTransferLine {
  itemId: Types.ObjectId;
  itemCode: string;
  itemName: string;
  variantSku?: string;
  quantity: number;
  unitCost: Types.Decimal128;
}

const transferLineSchema = new Schema<IStockTransferLine>(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    variantSku: { type: String },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: { type: Schema.Types.Decimal128, required: true, default: "0" },
  },
  { _id: false }
);

/**
 * Goods moving between the business's own warehouses.
 *
 * Deliberately has no accounting effect: the stock never left the business,
 * so posting a journal entry for it would inflate both sides of the ledger.
 */
export interface IStockTransfer {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;

  documentNumber: string;
  documentDate: Date;
  fromWarehouseId: Types.ObjectId;
  toWarehouseId: Types.ObjectId;
  notes?: string;

  lines: IStockTransferLine[];
  totalQuantity: number;

  status: "DRAFT" | "COMPLETED" | "CANCELLED";
  stockPosted: boolean;
  completedAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const stockTransferSchema = new Schema<IStockTransfer>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },

    documentNumber: { type: String, required: true },
    documentDate: { type: Date, required: true, default: () => new Date() },
    fromWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    toWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    notes: { type: String },

    lines: { type: [transferLineSchema], required: true, default: [] },
    totalQuantity: { type: Number, required: true, default: 0 },

    status: { type: String, enum: ["DRAFT", "COMPLETED", "CANCELLED"], required: true, default: "DRAFT" },
    stockPosted: { type: Boolean, required: true, default: false },
    completedAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

stockTransferSchema.index({ businessId: 1, documentNumber: 1 }, { unique: true });
stockTransferSchema.index({ businessId: 1, status: 1, documentDate: -1 });

export const StockTransfer =
  models.StockTransfer ?? model<IStockTransfer>("StockTransfer", stockTransferSchema);

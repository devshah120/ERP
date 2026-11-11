import { Schema, model, models } from "mongoose";

const dec = { type: Schema.Types.Decimal128, required: true, default: "0" };

const requestLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    variantSku: { type: String },
    quantity: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

export const TRANSFER_REQUEST_STATUSES = ["REQUESTED", "APPROVED", "REJECTED", "FULFILLED", "CANCELLED"] as const;

/**
 * A branch or store asking another warehouse for stock. Nothing moves until
 * it is approved and fulfilled — fulfilling raises a normal Stock Transfer,
 * so the stock ledger has one way in for warehouse-to-warehouse movement.
 */
const stockTransferRequestSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    requestNumber: { type: String, required: true },
    requestDate: { type: Date, required: true },
    requiredBy: { type: Date, default: null },
    fromWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    toWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    lines: { type: [requestLineSchema], default: [] },
    notes: { type: String, trim: true },
    status: { type: String, enum: TRANSFER_REQUEST_STATUSES, required: true, default: "REQUESTED" },
    approvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String },
    transferId: { type: Schema.Types.ObjectId, ref: "StockTransfer", default: null },
    transferNumber: { type: String },
    fulfilledAt: { type: Date, default: null },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
stockTransferRequestSchema.index({ businessId: 1, requestNumber: 1 }, { unique: true });
stockTransferRequestSchema.index({ businessId: 1, status: 1, requestDate: -1 });

export const StockTransferRequest =
  models.StockTransferRequest ?? model("StockTransferRequest", stockTransferRequestSchema);

const productionLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    variantSku: { type: String },
    quantity: { type: Number, required: true, min: 0 },
    unitCost: dec,
    value: dec,
  },
  { _id: false }
);

/**
 * Production stock movements.
 *
 * CONSUMPTION issues materials out of a warehouse (used up in sampling,
 * finishing, maintenance) and writes their value off to Materials Consumed.
 *
 * CREATION turns components into a product: components go out, the output
 * comes in at their combined cost plus any processing cost. Value stays in
 * stock, so no journal entry is posted — the same rule as a transfer.
 */
const productionEntrySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    kind: { type: String, enum: ["CREATION", "CONSUMPTION"], required: true },
    entryNumber: { type: String, required: true },
    entryDate: { type: Date, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    /** CREATION: where the finished output goes; defaults to warehouseId. */
    outputWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", default: null },
    formulaId: { type: Schema.Types.ObjectId, ref: "ProductionFormula", default: null },
    formulaName: { type: String },
    runs: { type: Number, default: 1 },
    purpose: { type: String, trim: true },
    components: { type: [productionLineSchema], default: [] },
    output: { type: productionLineSchema, default: null },
    processingCost: dec,
    totalValue: dec,
    notes: { type: String, trim: true },
    status: { type: String, enum: ["POSTED", "CANCELLED"], required: true, default: "POSTED" },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
productionEntrySchema.index({ businessId: 1, entryNumber: 1 }, { unique: true });
productionEntrySchema.index({ businessId: 1, kind: 1, entryDate: -1 });

export const ProductionEntry = models.ProductionEntry ?? model("ProductionEntry", productionEntrySchema);

import { Schema, model, models, Types } from "mongoose";

export const POS_PAYMENT_MODES = ["CASH", "CARD", "UPI"] as const;
export type PosPaymentMode = (typeof POS_PAYMENT_MODES)[number];

const dec = { type: Schema.Types.Decimal128, required: true, default: "0" };

/* ------------------------------------------------------------------ */
/* Register session                                                    */
/* ------------------------------------------------------------------ */

/**
 * One cashier's shift at a counter: opened with a cash float, closed with a
 * cash count. The difference between counted and expected cash is the
 * shift's over/short, kept forever for the audit trail.
 */
export interface IPosRegister {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  registerNumber: string;
  counterName: string;
  warehouseId: Types.ObjectId;
  status: "OPEN" | "CLOSED";
  openedBy: Types.ObjectId;
  openedAt: Date;
  openingCash: Types.Decimal128;
  closedBy?: Types.ObjectId | null;
  closedAt?: Date | null;
  expectedCash?: Types.Decimal128;
  countedCash?: Types.Decimal128;
  cashDifference?: Types.Decimal128;
  closingNotes?: string;
}

const posRegisterSchema = new Schema<IPosRegister>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    registerNumber: { type: String, required: true },
    counterName: { type: String, required: true, trim: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    status: { type: String, enum: ["OPEN", "CLOSED"], required: true, default: "OPEN" },
    openedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    openedAt: { type: Date, required: true, default: () => new Date() },
    openingCash: dec,
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    closedAt: { type: Date, default: null },
    expectedCash: dec,
    countedCash: dec,
    cashDifference: dec,
    closingNotes: { type: String, trim: true },
  },
  { timestamps: true }
);

posRegisterSchema.index({ businessId: 1, registerNumber: 1 }, { unique: true });
posRegisterSchema.index({ businessId: 1, status: 1, openedBy: 1 });

export const PosRegister = models.PosRegister ?? model<IPosRegister>("PosRegister", posRegisterSchema);

/* ------------------------------------------------------------------ */
/* Order                                                               */
/* ------------------------------------------------------------------ */

const posLineSchema = new Schema(
  {
    itemId: { type: Schema.Types.ObjectId, ref: "Item", required: true },
    itemCode: { type: String, required: true },
    itemName: { type: String, required: true },
    variantSku: { type: String },
    hsnCode: { type: String },
    quantity: { type: Number, required: true, min: 0 },
    /** Price as entered at the counter (tax-inclusive when POS Settings say so). */
    price: dec,
    discountPercent: { type: Number, default: 0 },
    /** Name of the automatic Discount that set discountPercent, if any. */
    discountName: { type: String },
    taxRatePercent: { type: Number, default: 0 },
    taxableAmount: dec,
    cgstAmount: dec,
    sgstAmount: dec,
    taxAmount: dec,
    lineTotal: dec,
    unitCost: dec,
    returnedQty: { type: Number, default: 0 },
  },
  { _id: false }
);

const posTotalsSchema = new Schema(
  {
    grossAmount: dec,
    discountAmount: dec,
    couponDiscount: dec,
    taxableAmount: dec,
    cgstAmount: dec,
    sgstAmount: dec,
    totalTax: dec,
    roundOff: dec,
    grandTotal: dec,
  },
  { _id: false }
);

const posPaymentSchema = new Schema(
  {
    mode: { type: String, enum: POS_PAYMENT_MODES, required: true },
    amount: dec,
    reference: { type: String, trim: true },
  },
  { _id: false }
);

/** A counter sale. Completing it moves stock out and posts the sale to the ledger. */
const posOrderSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    registerId: { type: Schema.Types.ObjectId, ref: "PosRegister", required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    orderNumber: { type: String, required: true },
    orderDate: { type: Date, required: true, default: () => new Date() },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer", default: null },
    customerName: { type: String, trim: true, default: "Walk-in customer" },
    customerPhone: { type: String, trim: true },
    lines: { type: [posLineSchema], default: [] },
    couponCode: { type: String, trim: true, uppercase: true },
    pricesIncludeTax: { type: Boolean, default: true },
    totals: { type: posTotalsSchema, default: () => ({}) },
    payments: { type: [posPaymentSchema], default: [] },
    amountTendered: dec,
    changeReturned: dec,
    refundedAmount: dec,
    status: { type: String, enum: ["COMPLETED", "CANCELLED"], required: true, default: "COMPLETED" },
    notes: { type: String, trim: true },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

posOrderSchema.index({ businessId: 1, orderNumber: 1 }, { unique: true });
posOrderSchema.index({ businessId: 1, orderDate: -1 });
posOrderSchema.index({ businessId: 1, registerId: 1 });

export const PosOrder = models.PosOrder ?? model("PosOrder", posOrderSchema);

/* ------------------------------------------------------------------ */
/* Credit note (return)                                                */
/* ------------------------------------------------------------------ */

/** Goods returned against a POS order: stock comes back in, money goes back out. */
const posCreditNoteSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    creditNoteNumber: { type: String, required: true },
    creditNoteDate: { type: Date, required: true, default: () => new Date() },
    registerId: { type: Schema.Types.ObjectId, ref: "PosRegister", default: null },
    orderId: { type: Schema.Types.ObjectId, ref: "PosOrder", required: true },
    orderNumber: { type: String, required: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse", required: true },
    customerName: { type: String, trim: true },
    lines: { type: [posLineSchema], default: [] },
    totals: { type: posTotalsSchema, default: () => ({}) },
    refundMode: { type: String, enum: POS_PAYMENT_MODES, required: true, default: "CASH" },
    reason: { type: String, trim: true },
    status: { type: String, enum: ["ISSUED", "CANCELLED"], required: true, default: "ISSUED" },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

posCreditNoteSchema.index({ businessId: 1, creditNoteNumber: 1 }, { unique: true });
posCreditNoteSchema.index({ businessId: 1, orderId: 1 });

export const PosCreditNote = models.PosCreditNote ?? model("PosCreditNote", posCreditNoteSchema);

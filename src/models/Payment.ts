import { Schema, model, models, Types } from "mongoose";
import { PAYMENT_MODES, type PaymentMode } from "@/lib/payments/types";

/**
 * Money actually moving, recorded against invoices.
 *
 * One collection serves both directions so receivable and payable analysis
 * share the same shape:
 *   RECEIPT — money in from a customer, settles sales invoices
 *   PAYMENT — money out to a vendor, settles purchase invoices
 *
 * An entry may be allocated across several invoices, or left partly
 * unallocated ("on account"), which is why allocations are a list rather
 * than a single invoice reference.
 */
export { PAYMENT_MODES };
export type { PaymentMode };

export interface IPaymentAllocation {
  invoiceType: "sales-invoices" | "purchase-invoices";
  invoiceId: Types.ObjectId;
  invoiceNumber: string;
  invoiceDate?: Date | null;
  amount: Types.Decimal128;
}

const paymentAllocationSchema = new Schema<IPaymentAllocation>(
  {
    invoiceType: { type: String, enum: ["sales-invoices", "purchase-invoices"], required: true },
    invoiceId: { type: Schema.Types.ObjectId, required: true },
    invoiceNumber: { type: String, required: true },
    invoiceDate: { type: Date, default: null },
    amount: { type: Schema.Types.Decimal128, required: true },
  },
  { _id: false }
);

export interface IPayment {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;

  documentNumber: string;
  documentDate: Date;

  /** RECEIPT = money in (customer), PAYMENT = money out (vendor). */
  direction: "RECEIPT" | "PAYMENT";
  partyType: "customer" | "vendor";
  partyId: Types.ObjectId;
  party: { code: string; name: string; gstin?: string };

  mode: PaymentMode;
  referenceNumber?: string;
  referenceDate?: Date | null;
  notes?: string;

  amount: Types.Decimal128;
  /** Sum of `allocations`; the remainder sits on account. */
  allocatedAmount: Types.Decimal128;
  unallocatedAmount: Types.Decimal128;
  allocations: IPaymentAllocation[];

  status: "CONFIRMED" | "CANCELLED";
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },

    documentNumber: { type: String, required: true },
    documentDate: { type: Date, required: true, default: () => new Date() },

    direction: { type: String, enum: ["RECEIPT", "PAYMENT"], required: true },
    partyType: { type: String, enum: ["customer", "vendor"], required: true },
    partyId: { type: Schema.Types.ObjectId, required: true },
    party: {
      code: { type: String, required: true },
      name: { type: String, required: true },
      gstin: { type: String },
    },

    mode: { type: String, enum: PAYMENT_MODES, required: true, default: "BANK" },
    referenceNumber: { type: String },
    referenceDate: { type: Date, default: null },
    notes: { type: String },

    amount: { type: Schema.Types.Decimal128, required: true },
    allocatedAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    unallocatedAmount: { type: Schema.Types.Decimal128, required: true, default: "0" },
    allocations: { type: [paymentAllocationSchema], default: [] },

    status: { type: String, enum: ["CONFIRMED", "CANCELLED"], required: true, default: "CONFIRMED" },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

paymentSchema.index({ businessId: 1, documentNumber: 1 }, { unique: true });
paymentSchema.index({ businessId: 1, direction: 1, documentDate: -1 });
paymentSchema.index({ businessId: 1, partyId: 1, documentDate: -1 });
paymentSchema.index({ businessId: 1, "allocations.invoiceId": 1 });

export const Payment = models.Payment ?? model<IPayment>("Payment", paymentSchema);

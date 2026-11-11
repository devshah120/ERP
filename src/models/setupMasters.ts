import { Schema } from "mongoose";
import { defineMasterModel } from "./shared/masterSchema";

export const BANK_ACCOUNT_TYPES = ["CURRENT", "SAVINGS", "OVERDRAFT", "CASH_CREDIT"] as const;

/**
 * A real bank account. Each one is linked to a ledger account, which is where
 * its money is actually recorded; reconciliation matches that ledger against
 * the bank statement.
 */
export const BankAccount = defineMasterModel("BankAccount", {
  accountName: { type: String, required: true, trim: true },
  bankName: { type: String, required: true, trim: true },
  accountNumber: { type: String, required: true, trim: true },
  ifscCode: { type: String, trim: true, uppercase: true },
  branchName: { type: String, trim: true },
  accountType: { type: String, enum: BANK_ACCOUNT_TYPES, default: "CURRENT" },
  ledgerAccountId: { type: Schema.Types.ObjectId, ref: "Account", default: null },
  upiId: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
  notes: { type: String, trim: true },
});

/** A GST slab and what it splits into. */
export const TaxRate = defineMasterModel("TaxRate", {
  name: { type: String, required: true, trim: true },
  ratePercent: { type: Number, required: true, min: 0, max: 100 },
  cessPercent: { type: Number, default: 0 },
  hsnCodes: { type: String, trim: true },
  description: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
});

/** Named credit terms, e.g. "Net 30". */
export const PaymentTerm = defineMasterModel("PaymentTerm", {
  name: { type: String, required: true, trim: true },
  creditDays: { type: Number, required: true, min: 0, default: 0 },
  /** Early-payment discount, e.g. 2% if paid within 10 days. */
  earlyPaymentDiscountPercent: { type: Number, default: 0 },
  earlyPaymentDays: { type: Number, default: 0 },
  description: { type: String, trim: true },
  isDefault: { type: Boolean, default: false },
});

export const CHARGE_TYPES = ["FIXED", "PERCENT"] as const;
export const CHARGE_APPLIES_TO = ["SALES", "PURCHASE", "BOTH"] as const;

/** Freight, packing, insurance — amounts added on top of the goods value. */
export const AdditionalCharge = defineMasterModel("AdditionalCharge", {
  name: { type: String, required: true, trim: true },
  chargeType: { type: String, enum: CHARGE_TYPES, default: "FIXED" },
  defaultAmount: { type: Schema.Types.Decimal128, default: "0" },
  taxRatePercent: { type: Number, default: 0 },
  hsnSac: { type: String, trim: true },
  appliesTo: { type: String, enum: CHARGE_APPLIES_TO, default: "BOTH" },
  description: { type: String, trim: true },
});

/** A billing counter, tablet or scanner approved to work with this workspace. */
export const Device = defineMasterModel(
  "Device",
  {
    deviceName: { type: String, required: true, trim: true },
    deviceId: { type: String, required: true, trim: true, uppercase: true },
    deviceType: { type: String, enum: ["POS_TERMINAL", "DESKTOP", "TABLET", "MOBILE", "SCANNER", "PRINTER"], default: "POS_TERMINAL" },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    assignedTo: { type: String, trim: true },
    notes: { type: String, trim: true },
  },
  { uniqueField: "deviceId" }
);

export const TARGET_METRICS = ["SALES_AMOUNT", "SALES_QUANTITY", "COLLECTION_AMOUNT", "PURCHASE_AMOUNT"] as const;

/** A goal for a period — the Target vs Actual report measures against it. */
export const SalesTarget = defineMasterModel("SalesTarget", {
  name: { type: String, required: true, trim: true },
  metric: { type: String, enum: TARGET_METRICS, required: true, default: "SALES_AMOUNT" },
  periodFrom: { type: Date, required: true },
  periodTo: { type: Date, required: true },
  targetValue: { type: Schema.Types.Decimal128, required: true, default: "0" },
  agentId: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
  categoryId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
  notes: { type: String, trim: true },
});

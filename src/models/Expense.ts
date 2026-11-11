import { Schema, model, models } from "mongoose";

const dec = { type: Schema.Types.Decimal128, required: true, default: "0" };

/**
 * Money spent on running the business — rent, salaries, electricity, petty
 * cash. Recording one posts the journal entry at once: the expense head and
 * any recoverable input GST debited, the cash or bank account credited.
 */
const expenseSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },
    expenseNumber: { type: String, required: true },
    expenseDate: { type: Date, required: true },
    expenseAccountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    expenseAccountName: { type: String, required: true },
    paidFromAccountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    paidFromAccountName: { type: String, required: true },
    payee: { type: String, trim: true },
    paymentMode: { type: String, enum: ["CASH", "BANK", "UPI", "CARD", "CHEQUE"], default: "CASH" },
    reference: { type: String, trim: true },
    amount: dec,
    taxRatePercent: { type: Number, default: 0 },
    interState: { type: Boolean, default: false },
    cgstAmount: dec,
    sgstAmount: dec,
    igstAmount: dec,
    totalAmount: dec,
    notes: { type: String, trim: true },
    status: { type: String, enum: ["POSTED", "CANCELLED"], required: true, default: "POSTED" },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

expenseSchema.index({ businessId: 1, expenseNumber: 1 }, { unique: true });
expenseSchema.index({ businessId: 1, expenseDate: -1 });

export const Expense = models.Expense ?? model("Expense", expenseSchema);

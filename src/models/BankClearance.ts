import { Schema, model, models } from "mongoose";

/**
 * Marks one voucher line on a bank ledger as having appeared on the bank
 * statement, and on which date. Kept outside the voucher so reconciling
 * never edits a posted journal entry.
 */
const bankClearanceSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    voucherId: { type: Schema.Types.ObjectId, ref: "Voucher", required: true },
    /** Position of the line within the voucher — a voucher can touch the bank twice. */
    lineIndex: { type: Number, required: true },
    clearedDate: { type: Date, required: true },
    clearedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

bankClearanceSchema.index({ businessId: 1, voucherId: 1, lineIndex: 1 }, { unique: true });
bankClearanceSchema.index({ businessId: 1, accountId: 1 });

export const BankClearance = models.BankClearance ?? model("BankClearance", bankClearanceSchema);

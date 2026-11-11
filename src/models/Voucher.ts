import { Schema, model, models, Types } from "mongoose";

export const VOUCHER_TYPES = ["JOURNAL", "PAYMENT", "RECEIPT", "CONTRA", "SALES", "PURCHASE"] as const;
export type VoucherType = (typeof VOUCHER_TYPES)[number];

export interface IVoucherLine {
  accountId: Types.ObjectId;
  accountCode: string;
  accountName: string;
  debit: Types.Decimal128;
  credit: Types.Decimal128;
  narration?: string;
}

const voucherLineSchema = new Schema<IVoucherLine>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: "Account", required: true },
    accountCode: { type: String, required: true },
    accountName: { type: String, required: true },
    debit: { type: Schema.Types.Decimal128, required: true, default: "0" },
    credit: { type: Schema.Types.Decimal128, required: true, default: "0" },
    narration: { type: String },
  },
  { _id: false }
);

/**
 * A double-entry journal voucher — the only thing that moves the ledger.
 *
 * Vouchers are either entered by hand or posted automatically by a source
 * document (an invoice, a receipt, a stock adjustment). Auto-posted vouchers
 * carry `sourceType`/`sourceId`, and a unique index on that pair makes
 * posting idempotent: re-running a backfill cannot double-count anything.
 */
export interface IVoucher {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;

  voucherNumber: string;
  voucherDate: Date;
  voucherType: VoucherType;

  lines: IVoucherLine[];
  totalDebit: Types.Decimal128;
  totalCredit: Types.Decimal128;

  narration?: string;
  referenceNumber?: string;

  /** Set when the voucher was raised by a document rather than by a person. */
  sourceType?: string | null;
  sourceId?: Types.ObjectId | null;
  sourceNumber?: string | null;
  /** True for auto-posted vouchers, which cannot be edited by hand. */
  isSystemGenerated: boolean;

  status: "POSTED" | "CANCELLED";
  cancelledBy?: Types.ObjectId | null;
  cancelledAt?: Date | null;
  cancellationReason?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const voucherSchema = new Schema<IVoucher>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },

    voucherNumber: { type: String, required: true },
    voucherDate: { type: Date, required: true, default: () => new Date() },
    voucherType: { type: String, enum: VOUCHER_TYPES, required: true, default: "JOURNAL" },

    lines: { type: [voucherLineSchema], required: true, default: [] },
    totalDebit: { type: Schema.Types.Decimal128, required: true, default: "0" },
    totalCredit: { type: Schema.Types.Decimal128, required: true, default: "0" },

    narration: { type: String },
    referenceNumber: { type: String },

    sourceType: { type: String, default: null },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    sourceNumber: { type: String, default: null },
    isSystemGenerated: { type: Boolean, required: true, default: false },

    status: { type: String, enum: ["POSTED", "CANCELLED"], required: true, default: "POSTED" },
    cancelledBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    cancelledAt: { type: Date, default: null },
    cancellationReason: { type: String },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

voucherSchema.index({ businessId: 1, voucherNumber: 1 }, { unique: true });
voucherSchema.index({ businessId: 1, voucherDate: -1 });
voucherSchema.index({ businessId: 1, "lines.accountId": 1, voucherDate: 1 });
// Idempotent auto-posting: one voucher per source document, enforced by the
// database rather than by a check the backfill could race against.
voucherSchema.index(
  { businessId: 1, sourceType: 1, sourceId: 1 },
  { unique: true, partialFilterExpression: { sourceId: { $type: "objectId" } } }
);

export const Voucher = models.Voucher ?? model<IVoucher>("Voucher", voucherSchema);

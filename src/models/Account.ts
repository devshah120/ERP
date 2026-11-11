import { Schema, model, models, Types } from "mongoose";

/**
 * The five account classes, and which side increases each one. Everything
 * else in the ledger derives from this table, so a balance can never be
 * computed with the wrong sign.
 */
export const ACCOUNT_TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NORMAL_BALANCE: Record<AccountType, "DEBIT" | "CREDIT"> = {
  ASSET: "DEBIT",
  EXPENSE: "DEBIT",
  LIABILITY: "CREDIT",
  EQUITY: "CREDIT",
  INCOME: "CREDIT",
};

/**
 * Accounts the posting engine looks up by role rather than by name, so a
 * business can rename "Sales" to "Revenue" without breaking auto-posting.
 * These are created once per tenant and cannot be deleted.
 */
export const SYSTEM_ACCOUNTS = [
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "SALES",
  "SALES_RETURNS",
  "PURCHASES",
  "PURCHASE_RETURNS",
  "OUTPUT_CGST",
  "OUTPUT_SGST",
  "OUTPUT_IGST",
  "INPUT_CGST",
  "INPUT_SGST",
  "INPUT_IGST",
  "CASH",
  "BANK",
  "FREIGHT_INCOME",
  "FREIGHT_EXPENSE",
  "ROUND_OFF",
  "CUSTOMER_ADVANCES",
  "SUPPLIER_ADVANCES",
  "INVENTORY",
  "STOCK_ADJUSTMENT",
  "OPENING_BALANCE_EQUITY",
  "MATERIAL_CONSUMPTION",
] as const;
export type SystemAccountRole = (typeof SYSTEM_ACCOUNTS)[number];

export interface IAccount {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;

  code: string;
  name: string;
  type: AccountType;
  /** Optional parent, for grouping (e.g. "Bank" under "Current Assets"). */
  parentId?: Types.ObjectId | null;
  /** Set on the accounts the posting engine needs; null for user accounts. */
  systemRole?: SystemAccountRole | null;

  description?: string;
  /** Opening balance as at the start of the financial year. */
  openingBalance: Types.Decimal128;
  openingBalanceType: "DEBIT" | "CREDIT";

  /** A group account holds other accounts and cannot be posted to directly. */
  isGroup: boolean;
  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const accountSchema = new Schema<IAccount>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },

    code: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Account", default: null },
    systemRole: { type: String, enum: SYSTEM_ACCOUNTS, default: null },

    description: { type: String },
    openingBalance: { type: Schema.Types.Decimal128, required: true, default: "0" },
    openingBalanceType: { type: String, enum: ["DEBIT", "CREDIT"], required: true, default: "DEBIT" },

    isGroup: { type: Boolean, required: true, default: false },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    deletedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

accountSchema.index({ businessId: 1, code: 1 }, { unique: true });
accountSchema.index({ businessId: 1, type: 1, name: 1 });
// One account per system role per tenant — the posting engine relies on
// exactly one match, and a duplicate would make postings non-deterministic.
accountSchema.index(
  { businessId: 1, systemRole: 1 },
  { unique: true, partialFilterExpression: { systemRole: { $type: "string" } } }
);

export const Account = models.Account ?? model<IAccount>("Account", accountSchema);

import { Schema, model, models, Types } from "mongoose";
import { addressSchema, type IAddress } from "./shared/Address";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export const CUSTOMER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

export const BALANCE_TYPES = ["DEBIT", "CREDIT"] as const;
export type BalanceType = (typeof BALANCE_TYPES)[number];

export interface ICustomer extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  customerCode: string;
  name: string;
  companyName?: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  alternatePhone?: string;
  billingAddress: IAddress;
  shippingAddress?: IAddress; // absent = same as billing
  gstin?: string;
  creditLimit: Types.Decimal128;
  creditDays: number;
  paymentTerms?: string;
  currency: string;
  salespersonId?: Types.ObjectId;
  customerGroup?: string;
  openingBalance: Types.Decimal128;
  openingBalanceType: BalanceType;
  status: CustomerStatus;
  notes?: string;
  deletedAt?: Date | null;
}

const customerSchema = new Schema<ICustomer>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    customerCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    alternatePhone: { type: String, trim: true },
    billingAddress: { type: addressSchema, required: true },
    shippingAddress: { type: addressSchema },
    gstin: { type: String, trim: true, uppercase: true },
    creditLimit: { type: Schema.Types.Decimal128, required: true, default: "0" },
    creditDays: { type: Number, required: true, default: 0, min: 0 },
    paymentTerms: { type: String, trim: true },
    currency: { type: String, required: true },
    salespersonId: { type: Schema.Types.ObjectId, ref: "User" },
    customerGroup: { type: String, trim: true },
    openingBalance: { type: Schema.Types.Decimal128, required: true, default: "0" },
    openingBalanceType: { type: String, enum: BALANCE_TYPES, required: true, default: "DEBIT" },
    status: { type: String, enum: CUSTOMER_STATUSES, required: true, default: "ACTIVE" },
    notes: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

customerSchema.index({ businessId: 1, customerCode: 1 }, { unique: true });
customerSchema.index({ businessId: 1, status: 1, name: 1 });
customerSchema.index({ businessId: 1, name: "text", companyName: "text", phone: "text", email: "text" });

export const Customer = models.Customer ?? model<ICustomer>("Customer", customerSchema);

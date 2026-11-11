import { Schema, model, models, Types } from "mongoose";
import { addressSchema, type IAddress } from "./shared/Address";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export const VENDOR_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export interface IVendor extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  vendorCode: string;
  name: string;
  companyName?: string;
  contactPerson?: string;
  email?: string;
  phone: string;
  alternatePhone?: string;
  billingAddress: IAddress;
  gstin?: string;
  panNumber?: string;
  creditLimit: Types.Decimal128;
  creditDays: number;
  paymentTerms?: string;
  currency: string;
  vendorGroup?: string;
  openingBalance: Types.Decimal128;
  openingBalanceType: "DEBIT" | "CREDIT";
  status: VendorStatus;
  notes?: string;
  deletedAt?: Date | null;
}

const vendorSchema = new Schema<IVendor>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    vendorCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    companyName: { type: String, trim: true },
    contactPerson: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    alternatePhone: { type: String, trim: true },
    billingAddress: { type: addressSchema, required: true },
    gstin: { type: String, trim: true, uppercase: true },
    panNumber: { type: String, trim: true, uppercase: true },
    creditLimit: { type: Schema.Types.Decimal128, required: true, default: "0" },
    creditDays: { type: Number, required: true, default: 0, min: 0 },
    paymentTerms: { type: String, trim: true },
    currency: { type: String, required: true },
    vendorGroup: { type: String, trim: true },
    openingBalance: { type: Schema.Types.Decimal128, required: true, default: "0" },
    openingBalanceType: { type: String, enum: ["DEBIT", "CREDIT"], required: true, default: "CREDIT" },
    status: { type: String, enum: VENDOR_STATUSES, required: true, default: "ACTIVE" },
    notes: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

vendorSchema.index({ businessId: 1, vendorCode: 1 }, { unique: true });
vendorSchema.index({ businessId: 1, status: 1, name: 1 });

export const Vendor = models.Vendor ?? model<IVendor>("Vendor", vendorSchema);

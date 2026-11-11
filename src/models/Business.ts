import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields } from "./shared/types";

export const BUSINESS_STATUSES = ["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"] as const;
export type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

export interface IBusiness extends BaseAuditFields {
  _id: Types.ObjectId;
  legalName: string;
  tradeName: string;
  businessType: string;
  domain: string;
  email: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  address: string;
  currency: string;
  timeZone: string;
  gstin?: string;
  registrationNumber?: string;
  logoUrl?: string;
  financialYearStartMonth: number; // 1-12
  status: BusinessStatus;
  defaultBranchId?: Types.ObjectId;
  defaultWarehouseId?: Types.ObjectId;
}

const businessSchema = new Schema<IBusiness>(
  {
    legalName: { type: String, required: true, trim: true },
    tradeName: { type: String, required: true, trim: true },
    businessType: { type: String, required: true, trim: true },
    domain: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]{3,63}$/,
    },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    country: { type: String, required: true },
    state: { type: String, required: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
    currency: { type: String, required: true, default: "INR" },
    timeZone: { type: String, required: true, default: "Asia/Kolkata" },
    gstin: { type: String, trim: true, uppercase: true },
    registrationNumber: { type: String, trim: true },
    logoUrl: { type: String },
    financialYearStartMonth: { type: Number, required: true, min: 1, max: 12, default: 4 },
    status: { type: String, enum: BUSINESS_STATUSES, required: true, default: "PENDING_VERIFICATION" },
    defaultBranchId: { type: Schema.Types.ObjectId, ref: "Branch" },
    defaultWarehouseId: { type: Schema.Types.ObjectId, ref: "Warehouse" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

export const Business = models.Business ?? model<IBusiness>("Business", businessSchema);

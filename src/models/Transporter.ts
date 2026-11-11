import { Schema, model, models, Types } from "mongoose";
import { addressSchema, type IAddress } from "./shared/Address";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface ITransporter extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  transporterCode: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  gstin?: string;
  /** Transporter ID required on Indian e-way bills. */
  transporterId?: string;
  address?: IAddress;
  vehicleTypes?: string;
  status: "ACTIVE" | "INACTIVE";
  notes?: string;
  deletedAt?: Date | null;
}

const transporterSchema = new Schema<ITransporter>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    transporterCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    contactPerson: { type: String, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    gstin: { type: String, trim: true, uppercase: true },
    transporterId: { type: String, trim: true, uppercase: true },
    address: { type: addressSchema },
    vehicleTypes: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    notes: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

transporterSchema.index({ businessId: 1, transporterCode: 1 }, { unique: true });

export const Transporter = models.Transporter ?? model<ITransporter>("Transporter", transporterSchema);

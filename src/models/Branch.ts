import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface IBranch extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  code: string;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;
}

const branchSchema = new Schema<IBranch>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    address: { type: String },
    isDefault: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

branchSchema.index({ businessId: 1, code: 1 }, { unique: true });

export const Branch = models.Branch ?? model<IBranch>("Branch", branchSchema);

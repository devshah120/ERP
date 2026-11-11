import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface IBrand extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  brandCode: string;
  name: string;
  description?: string;
  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;
}

const brandSchema = new Schema<IBrand>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    brandCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

brandSchema.index({ businessId: 1, brandCode: 1 }, { unique: true });

export const Brand = models.Brand ?? model<IBrand>("Brand", brandSchema);

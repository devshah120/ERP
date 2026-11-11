import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface IWarehouse extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  branchId: Types.ObjectId;
  code: string;
  name: string;
  address?: string;
  isDefault: boolean;
  isActive: boolean;
  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;
}

const warehouseSchema = new Schema<IWarehouse>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
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

warehouseSchema.index({ businessId: 1, code: 1 }, { unique: true });

export const Warehouse = models.Warehouse ?? model<IWarehouse>("Warehouse", warehouseSchema);

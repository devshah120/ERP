import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";
import { PERMISSIONS_VERSION } from "@/lib/auth/permissionCatalog";

export interface IRole extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  /** Permission keys, e.g. "sales.quotation.create", "sales.order.approve". "*" grants everything. */
  permissions: string[];
  /** Catalog version the list was written for; older roles are upgraded once (src/lib/auth/roleUpgrade.ts). Missing = 0. */
  permissionsVersion: number;
  isSystemRole: boolean; // Owner/Admin roles auto-created per business, not deletable
  isActive: boolean;
}

const roleSchema = new Schema<IRole>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    permissions: { type: [String], required: true, default: [] },
    permissionsVersion: { type: Number, default: PERMISSIONS_VERSION },
    isSystemRole: { type: Boolean, required: true, default: false },
    isActive: { type: Boolean, required: true, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

roleSchema.index({ businessId: 1, name: 1 }, { unique: true });

export const Role = models.Role ?? model<IRole>("Role", roleSchema);

/** The Owner role is created automatically at business registration and always grants everything. */
export const OWNER_ROLE_NAME = "Owner";
export const OWNER_ALL_PERMISSIONS = "*";

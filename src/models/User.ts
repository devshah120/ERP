import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export const USER_STATUSES = ["PENDING_VERIFICATION", "ACTIVE", "LOCKED", "DISABLED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  name: string;
  username: string;
  email: string;
  phone: string;
  passwordHash: string;
  roleId: Types.ObjectId;
  branchIds: Types.ObjectId[]; // empty array = all branches
  warehouseIds: Types.ObjectId[]; // empty array = all warehouses
  status: UserStatus;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;
  lastLoginAt?: Date | null;
  mustChangePassword: boolean;
  passwordChangedAt?: Date | null;
}

const userSchema = new Schema<IUser>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    name: { type: String, required: true, trim: true },
    username: { type: String, required: true, trim: true, lowercase: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: "" },
    passwordHash: { type: String, required: true, select: false },
    roleId: { type: Schema.Types.ObjectId, ref: "Role", required: true },
    branchIds: { type: [Schema.Types.ObjectId], ref: "Branch", default: [] },
    warehouseIds: { type: [Schema.Types.ObjectId], ref: "Warehouse", default: [] },
    status: { type: String, enum: USER_STATUSES, required: true, default: "PENDING_VERIFICATION" },
    isEmailVerified: { type: Boolean, required: true, default: false },
    isPhoneVerified: { type: Boolean, required: true, default: false },
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, required: true, default: false },
    passwordChangedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

// Email (the sign-in id) and the internal username are unique per-tenant, not globally.
userSchema.index({ businessId: 1, username: 1 }, { unique: true });
userSchema.index({ businessId: 1, email: 1 }, { unique: true });
// Sign-in by email looks users up across workspaces.
userSchema.index({ email: 1 });

export const User = models.User ?? model<IUser>("User", userSchema);

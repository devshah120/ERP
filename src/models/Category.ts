import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface ICategory extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  categoryCode: string;
  name: string;
  /** Self-reference enables Category → Subcategory hierarchies. */
  parentId?: Types.ObjectId | null;
  description?: string;
  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;
}

const categorySchema = new Schema<ICategory>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    categoryCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: "Category", default: null },
    description: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

categorySchema.index({ businessId: 1, categoryCode: 1 }, { unique: true });
categorySchema.index({ businessId: 1, parentId: 1 });

export const Category = models.Category ?? model<ICategory>("Category", categorySchema);

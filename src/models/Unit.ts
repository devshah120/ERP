import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface IUnit extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  unitCode: string; // e.g. "PCS", "MTR", "KG"
  name: string; // e.g. "Pieces", "Metres"
  /** Decimal places allowed for quantities in this unit (0 for pieces, 3 for metres). */
  decimalPlaces: number;
  status: "ACTIVE" | "INACTIVE";
  deletedAt?: Date | null;
}

const unitSchema = new Schema<IUnit>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    unitCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    decimalPlaces: { type: Number, required: true, default: 0, min: 0, max: 4 },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

unitSchema.index({ businessId: 1, unitCode: 1 }, { unique: true });

export const Unit = models.Unit ?? model<IUnit>("Unit", unitSchema);

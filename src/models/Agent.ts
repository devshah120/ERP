import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export interface IAgent extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  agentCode: string;
  name: string;
  phone: string;
  email?: string;
  /** Commission percentage on sales booked through this agent. */
  commissionPercent: number;
  panNumber?: string;
  city?: string;
  status: "ACTIVE" | "INACTIVE";
  notes?: string;
  deletedAt?: Date | null;
}

const agentSchema = new Schema<IAgent>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    agentCode: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    commissionPercent: { type: Number, required: true, default: 0, min: 0, max: 100 },
    panNumber: { type: String, trim: true, uppercase: true },
    city: { type: String, trim: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], required: true, default: "ACTIVE" },
    notes: { type: String, trim: true },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

agentSchema.index({ businessId: 1, agentCode: 1 }, { unique: true });

export const Agent = models.Agent ?? model<IAgent>("Agent", agentSchema);

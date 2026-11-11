import { Schema, model, models, Types } from "mongoose";

/**
 * Atomic per-business counters for master-data codes (customer code, item
 * SKU sequence, etc). Deliberately separate from DocumentSequence
 * (src/models/DocumentSequence.ts): master data isn't scoped to a branch
 * or financial year the way transactional documents are.
 */
export interface IMasterCounter {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  entityType: string; // e.g. "CUSTOMER", "SUPPLIER", "ITEM"
  lastNumber: number;
}

const masterCounterSchema = new Schema<IMasterCounter>({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
  entityType: { type: String, required: true },
  lastNumber: { type: Number, required: true, default: 0 },
});

masterCounterSchema.index({ businessId: 1, entityType: 1 }, { unique: true });

export const MasterCounter = models.MasterCounter ?? model<IMasterCounter>("MasterCounter", masterCounterSchema);

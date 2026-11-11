import { Schema, model, models, Types } from "mongoose";

/**
 * A business's own prefix for one numbered document type, overriding the
 * built-in default (e.g. "TI" instead of "INV"). Read by the numbering
 * service on every allocation, so it applies to every module at once.
 */
export interface IDocumentPrefix {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  documentType: string;
  prefix: string;
  padding: number;
  updatedBy?: Types.ObjectId | null;
}

const documentPrefixSchema = new Schema<IDocumentPrefix>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    documentType: { type: String, required: true },
    prefix: { type: String, required: true, trim: true, uppercase: true },
    padding: { type: Number, required: true, min: 3, max: 10, default: 6 },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

documentPrefixSchema.index({ businessId: 1, documentType: 1 }, { unique: true });

export const DocumentPrefix = models.DocumentPrefix ?? model<IDocumentPrefix>("DocumentPrefix", documentPrefixSchema);

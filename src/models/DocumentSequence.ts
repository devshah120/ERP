import { Schema, model, models, Types } from "mongoose";

export interface IDocumentSequence {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  branchId: Types.ObjectId;
  financialYearId: Types.ObjectId;
  documentType: string; // e.g. "SALES_QUOTATION", "SALES_ORDER", "PURCHASE_INVOICE"
  prefix: string; // e.g. "QTN"
  lastNumber: number;
  padding: number; // number of digits, e.g. 6 => 000001
}

const documentSequenceSchema = new Schema<IDocumentSequence>({
  businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
  branchId: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
  financialYearId: { type: Schema.Types.ObjectId, ref: "FinancialYear", required: true },
  documentType: { type: String, required: true },
  prefix: { type: String, required: true },
  lastNumber: { type: Number, required: true, default: 0 },
  padding: { type: Number, required: true, default: 6 },
});

documentSequenceSchema.index(
  { businessId: 1, branchId: 1, financialYearId: 1, documentType: 1 },
  { unique: true }
);

export const DocumentSequence =
  models.DocumentSequence ?? model<IDocumentSequence>("DocumentSequence", documentSequenceSchema);

import { Schema, model, models, type Types } from "mongoose";

/**
 * A company document kept in the workspace's own storage (Utilities →
 * Storage): agreements, licences, logos, scanned bills. The file bytes live
 * on the record itself — `data` is never selected unless a download asks for
 * it, so listing stays light. Files are capped well below MongoDB's 16 MB
 * document limit.
 */
export interface IStoredFile {
  businessId: Types.ObjectId;
  name: string;
  fileName: string;
  mimeType: string;
  size: number;
  data: Buffer;
  remarks: string;
  createdBy: Types.ObjectId | null;
  createdByName: string;
  createdAt: Date;
  updatedAt: Date;
}

const storedFileSchema = new Schema<IStoredFile>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    name: { type: String, required: true, trim: true },
    fileName: { type: String, required: true, trim: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    remarks: { type: String, trim: true, default: "" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByName: { type: String, default: "" },
  },
  { timestamps: true }
);

storedFileSchema.index({ businessId: 1, createdAt: -1 });

export const StoredFile = models.StoredFile ?? model<IStoredFile>("StoredFile", storedFileSchema);

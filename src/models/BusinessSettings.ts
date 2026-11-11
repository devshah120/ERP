import { Schema, model, models, Types } from "mongoose";

/**
 * One document per business holding every settings section. Sections are
 * stored loosely and always read back through their zod schema
 * (src/lib/settings/definitions.ts), which supplies defaults for anything
 * missing — so adding a setting never needs a migration.
 */
export interface IBusinessSettings {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  sections: Record<string, Record<string, unknown>>;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const businessSettingsSchema = new Schema<IBusinessSettings>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true, unique: true },
    sections: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, minimize: false }
);

export const BusinessSettings =
  models.BusinessSettings ?? model<IBusinessSettings>("BusinessSettings", businessSettingsSchema);

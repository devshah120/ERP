import { Schema, model, models, Types } from "mongoose";

export interface ISession {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  refreshTokenHash: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    refreshTokenHash: { type: String, required: true, select: false },
    userAgent: { type: String },
    ip: { type: String },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

sessionSchema.index({ userId: 1, revokedAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = models.Session ?? model<ISession>("Session", sessionSchema);

import { Schema, model, models, Types } from "mongoose";

export const LOGIN_EVENT_TYPES = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "ACCOUNT_LOCKED",
  "PASSWORD_CHANGED",
] as const;
export type LoginEventType = (typeof LOGIN_EVENT_TYPES)[number];

export interface ILoginHistory {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  event: LoginEventType;
  reason?: string;
  ip?: string;
  userAgent?: string;
  createdAt: Date;
}

const loginHistorySchema = new Schema<ILoginHistory>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    event: { type: String, enum: LOGIN_EVENT_TYPES, required: true },
    reason: { type: String },
    ip: { type: String },
    userAgent: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

loginHistorySchema.index({ businessId: 1, userId: 1, createdAt: -1 });

export const LoginHistory = models.LoginHistory ?? model<ILoginHistory>("LoginHistory", loginHistorySchema);

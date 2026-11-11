import { Schema, model, models, Types } from "mongoose";

export const OTP_PURPOSES = ["REGISTRATION", "LOGIN_2FA", "PASSWORD_RESET"] as const;
export type OtpPurpose = (typeof OTP_PURPOSES)[number];

export const OTP_CHANNELS = ["EMAIL", "SMS"] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export const OTP_STATUSES = ["PENDING", "VERIFIED", "EXPIRED", "CANCELLED"] as const;
export type OtpStatus = (typeof OTP_STATUSES)[number];

export interface IOtpVerification {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId;
  purpose: OtpPurpose;
  channel: OtpChannel;
  target: string; // email or phone the OTP was sent to
  codeHash: string; // never store the plaintext code
  expiresAt: Date;
  attempts: number;
  maxAttempts: number;
  resendCount: number;
  lastSentAt: Date;
  status: OtpStatus;
  consumedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const otpVerificationSchema = new Schema<IOtpVerification>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    purpose: { type: String, enum: OTP_PURPOSES, required: true },
    channel: { type: String, enum: OTP_CHANNELS, required: true },
    target: { type: String, required: true },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, required: true, default: 0 },
    maxAttempts: { type: Number, required: true },
    resendCount: { type: Number, required: true, default: 0 },
    lastSentAt: { type: Date, required: true, default: () => new Date() },
    status: { type: String, enum: OTP_STATUSES, required: true, default: "PENDING" },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

otpVerificationSchema.index({ businessId: 1, userId: 1, purpose: 1, status: 1 });
// TTL cleanup: purge stale OTP documents 1 day after expiry, keeps the collection small.
otpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 24 * 60 * 60 });

export const OtpVerification =
  models.OtpVerification ?? model<IOtpVerification>("OtpVerification", otpVerificationSchema);

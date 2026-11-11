import { Schema, model, models, Types } from "mongoose";

export const AUDIT_ACTIONS = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "APPROVE",
  "REJECT",
  "CANCEL",
  "POST",
  "UNPOST",
  "LOGIN",
  "LOGOUT",
  "PASSWORD_CHANGE",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface IAuditLog {
  _id: Types.ObjectId;
  businessId: Types.ObjectId;
  userId: Types.ObjectId | null;
  action: AuditAction;
  module: string; // e.g. "auth", "sales.quotation"
  documentType?: string;
  documentId?: Types.ObjectId;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ip?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, enum: AUDIT_ACTIONS, required: true },
    module: { type: String, required: true },
    documentType: { type: String },
    documentId: { type: Schema.Types.ObjectId },
    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    reason: { type: String },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ businessId: 1, documentType: 1, documentId: 1, createdAt: -1 });
auditLogSchema.index({ businessId: 1, module: 1, createdAt: -1 });

export const AuditLog = models.AuditLog ?? model<IAuditLog>("AuditLog", auditLogSchema);

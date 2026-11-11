import { Types } from "mongoose";
import { AuditLog, type AuditAction } from "@/models/AuditLog";

export interface RecordAuditParams {
  businessId: Types.ObjectId | string;
  userId: Types.ObjectId | string | null;
  action: AuditAction;
  module: string;
  documentType?: string;
  documentId?: Types.ObjectId | string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  ip?: string;
}

/** Fire-and-forget audit write. Never blocks or fails the primary operation on logging failure. */
export async function recordAudit(params: RecordAuditParams): Promise<void> {
  try {
    await AuditLog.create({
      businessId: params.businessId,
      userId: params.userId,
      action: params.action,
      module: params.module,
      documentType: params.documentType,
      documentId: params.documentId,
      oldValue: params.oldValue,
      newValue: params.newValue,
      reason: params.reason,
      ip: params.ip,
    });
  } catch (err) {
    console.error("[AUDIT_LOG_WRITE_FAILED]", err);
  }
}

import { Schema, model, models, Types } from "mongoose";
import type { BaseAuditFields, TenantScoped } from "./shared/types";

export const FINANCIAL_YEAR_STATUSES = ["OPEN", "CLOSED"] as const;
export type FinancialYearStatus = (typeof FINANCIAL_YEAR_STATUSES)[number];

export interface IFinancialYear extends BaseAuditFields, TenantScoped {
  _id: Types.ObjectId;
  label: string; // e.g. "2026-2027"
  startDate: Date;
  endDate: Date;
  status: FinancialYearStatus;
  isCurrent: boolean;
  closedAt?: Date | null;
  closedBy?: Types.ObjectId | null;
}

const financialYearSchema = new Schema<IFinancialYear>(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    label: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    status: { type: String, enum: FINANCIAL_YEAR_STATUSES, required: true, default: "OPEN" },
    isCurrent: { type: Boolean, required: true, default: false },
    closedAt: { type: Date, default: null },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

financialYearSchema.index({ businessId: 1, label: 1 }, { unique: true });

export const FinancialYear = models.FinancialYear ?? model<IFinancialYear>("FinancialYear", financialYearSchema);

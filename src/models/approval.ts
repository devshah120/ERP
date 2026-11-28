import { Schema, model, models, type Model } from "mongoose";
import { APPROVER_TYPES } from "@/lib/approvals/catalog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defineModel(name: string, schema: Schema): Model<any> {
  return models[name] ?? model(name, schema);
}

/** A named set of users; any one of them can approve a stage given to the group. */
const approvalUserGroupSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: "" },
    userIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    status: { type: String, enum: ["ACTIVE", "INACTIVE"], default: "ACTIVE" },
    deletedAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
approvalUserGroupSchema.index({ businessId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
approvalUserGroupSchema.index({ businessId: 1, userIds: 1 });
export const ApprovalUserGroup = defineModel("ApprovalUserGroup", approvalUserGroupSchema);

const stageSchema = new Schema(
  {
    approverType: { type: String, enum: APPROVER_TYPES, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    groupId: { type: Schema.Types.ObjectId, ref: "ApprovalUserGroup", default: null },
    /** The stage applies only when the document's amount is more than this. Null = always. */
    minAmount: { type: Schema.Types.Decimal128, default: null },
  },
  { _id: false }
);

/** How one document is approved: up to three stages, in order. One scheme per document. */
const approvalSchemeSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    document: { type: String, required: true },
    approvalRequired: { type: Boolean, default: true },
    stages: { type: [stageSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);
approvalSchemeSchema.index({ businessId: 1, document: 1 }, { unique: true });
export const ApprovalScheme = defineModel("ApprovalScheme", approvalSchemeSchema);

const requestStageSchema = new Schema(
  {
    stage: { type: Number, required: true },
    approverType: { type: String, enum: APPROVER_TYPES, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    groupId: { type: Schema.Types.ObjectId, ref: "ApprovalUserGroup", default: null },
    minAmount: { type: Schema.Types.Decimal128, default: null },
    /** PENDING → APPROVED / REJECTED; SKIPPED when the amount is under the limit or no reporting manager is set. */
    status: { type: String, enum: ["WAITING", "PENDING", "APPROVED", "REJECTED", "SKIPPED"], default: "WAITING" },
    decidedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    decidedByName: { type: String, default: "" },
    decidedAt: { type: Date, default: null },
    note: { type: String, default: "" },
    skippedReason: { type: String, default: "" },
    /** Why the stage went to the workspace owner instead (no reporting manager, approver disabled, empty group…). */
    escalatedReason: { type: String, default: "" },
    /** The workspace owner decided a stage that was not theirs. */
    override: { type: Boolean, default: false },
  },
  { _id: false }
);

/** One record going through its scheme. The queue reads these. */
const approvalRequestSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    document: { type: String, required: true },
    recordId: { type: Schema.Types.ObjectId, required: true },
    recordNumber: { type: String, default: "" },
    summary: { type: String, default: "" },
    amount: { type: Schema.Types.Decimal128, default: null },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    requestedByName: { type: String, default: "" },
    /** The employee the request is for (HR) or the employee record of whoever raised it (ERP); used for "Reporting Manager". */
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    status: { type: String, enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED"], default: "PENDING" },
    currentStage: { type: Number, default: 0 },
    /** Who may act on the current stage: named users, or anyone in the group. */
    currentApproverUserIds: { type: [Schema.Types.ObjectId], default: [] },
    currentGroupId: { type: Schema.Types.ObjectId, default: null },
    stages: { type: [requestStageSchema], default: [] },
    /** What was sent for approval (amount, lines, dates…). A change restarts approval from stage 1. */
    fingerprint: { type: String, default: "" },
    /** Why a request was closed without a decision, e.g. changed after it was sent. */
    closedReason: { type: String, default: "" },
  },
  // Two approvers deciding the same stage at once: the second save fails instead of both counting.
  { timestamps: true, optimisticConcurrency: true }
);
approvalRequestSchema.index({ businessId: 1, document: 1, recordId: 1, createdAt: -1 });
approvalRequestSchema.index({ businessId: 1, status: 1, currentApproverUserIds: 1 });
approvalRequestSchema.index({ businessId: 1, status: 1, currentGroupId: 1 });
export const ApprovalRequest = defineModel("ApprovalRequest", approvalRequestSchema);

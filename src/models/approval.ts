import { Schema, model, models, type Model } from "mongoose";
import { APPROVER_TYPES, APPROVAL_STATUSES } from "@/lib/approvals/catalog";

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
    /** DESIGNATED_ROLE: anyone holding this role approves. */
    roleId: { type: Schema.Types.ObjectId, ref: "Role", default: null },
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
    roleId: { type: Schema.Types.ObjectId, ref: "Role", default: null },
    minAmount: { type: Schema.Types.Decimal128, default: null },
    /** PENDING → APPROVED / REJECTED / SENT_BACK; SKIPPED when the amount is not over the stage's limit. */
    status: { type: String, enum: ["WAITING", "PENDING", "APPROVED", "REJECTED", "SENT_BACK", "SKIPPED"], default: "WAITING" },
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

const commentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    text: { type: String, required: true },
    /** Stage the request was at; 0 once it was closed. */
    stage: { type: Number, default: 0 },
    /** COMMENT, or the decision the note came with. */
    kind: { type: String, enum: ["COMMENT", "APPROVE", "REJECT", "SEND_BACK", "RESUBMIT", "WITHDRAW"], default: "COMMENT" },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false }
);

/** One label/value line describing what is being approved. */
const detailSchema = new Schema({ label: { type: String, required: true }, value: { type: String, default: "" } }, { _id: false });

/**
 * One record (or held operation) going through its scheme. The approval
 * screens read these.
 */
const approvalRequestSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    document: { type: String, required: true },
    /** "record": the module's own record waits for approval; "action": the operation in `payload` is held until the last stage approves. */
    kind: { type: String, enum: ["record", "action"], default: "record" },
    /** APR-000123. Requests from before numbering show the record number instead. */
    requestNo: { type: String, default: "" },
    /** The record approved; for an action, the record it changes (a fresh id when it changes no single record). */
    recordId: { type: Schema.Types.ObjectId, required: true },
    recordNumber: { type: String, default: "" },
    summary: { type: String, default: "" },
    amount: { type: Schema.Types.Decimal128, default: null },
    requestedByUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    requestedByName: { type: String, default: "" },
    /** The employee the request is for (HR) or the employee record of whoever raised it (ERP); used for "Reporting Manager" and "Department Head". */
    employeeId: { type: Schema.Types.ObjectId, ref: "Employee", default: null },
    /** The department of that employee when the request was raised, for lists. */
    departmentName: { type: String, default: "" },
    status: { type: String, enum: APPROVAL_STATUSES, default: "PENDING" },
    currentStage: { type: Number, default: 0 },
    /** Who may act on the current stage: named users, anyone in the group, or anyone holding the role. */
    currentApproverUserIds: { type: [Schema.Types.ObjectId], default: [] },
    currentGroupId: { type: Schema.Types.ObjectId, default: null },
    currentRoleId: { type: Schema.Types.ObjectId, default: null },
    stages: { type: [requestStageSchema], default: [] },
    /** What was sent for approval (amount, lines, dates…). A change restarts approval from stage 1. */
    fingerprint: { type: String, default: "" },
    /** Why a request was closed without a decision, e.g. changed after it was sent. */
    closedReason: { type: String, default: "" },
    /** Action only: what it changes, so a second change to the same thing waits for the first ("employee:<id>", "attendance:2026-11-28"). */
    targetKey: { type: String, default: "" },
    /** Action only: the validated input the operation runs with once approved. */
    payload: { type: Schema.Types.Mixed, default: null },
    /** What the approver signs off, line by line. */
    details: { type: [detailSchema], default: [] },
    comments: { type: [commentSchema], default: [] },
    /** Action only: set while the approved operation runs, so two final approvals can't both run it. */
    executingAt: { type: Date, default: null },
    /** Action only: what running it did. */
    resultSummary: { type: String, default: "" },
    /** When the request was approved, rejected, sent back or cancelled. */
    decidedAt: { type: Date, default: null },
  },
  // Two approvers deciding the same stage at once: the second save fails instead of both counting.
  { timestamps: true, optimisticConcurrency: true }
);
approvalRequestSchema.index({ businessId: 1, document: 1, recordId: 1, createdAt: -1 });
approvalRequestSchema.index({ businessId: 1, status: 1, currentApproverUserIds: 1 });
approvalRequestSchema.index({ businessId: 1, status: 1, currentGroupId: 1 });
approvalRequestSchema.index({ businessId: 1, status: 1, currentRoleId: 1 });
approvalRequestSchema.index({ businessId: 1, requestedByUserId: 1, createdAt: -1 });
approvalRequestSchema.index({ businessId: 1, "stages.decidedByUserId": 1, createdAt: -1 });
approvalRequestSchema.index({ businessId: 1, document: 1, targetKey: 1, status: 1 });
export const ApprovalRequest = defineModel("ApprovalRequest", approvalRequestSchema);

/**
 * In-app notice for one user: an approval waiting for them, or a decision or
 * comment on something they raised or decided. Read from the bell in the top bar.
 */
const notificationSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: "Business", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["APPROVAL_PENDING", "APPROVAL_DECIDED", "APPROVAL_COMMENT"], required: true },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    href: { type: String, default: "" },
    approvalRequestId: { type: Schema.Types.ObjectId, ref: "ApprovalRequest", default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);
notificationSchema.index({ businessId: 1, userId: 1, createdAt: -1 });
// Notices are a convenience, not the record (that is the request and the audit log): they go after 120 days.
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 120 * 24 * 3600 });
export const Notification = defineModel("Notification", notificationSchema);

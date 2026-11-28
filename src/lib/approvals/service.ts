import mongoose, { Types } from "mongoose";
import { createHash } from "crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { ApprovalScheme, ApprovalUserGroup, ApprovalRequest } from "@/models/approval";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { AuditLog } from "@/models/AuditLog";
import { Employee } from "@/models/hr";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { APPROVAL_DOCUMENTS, APPROVER_TYPES, APPROVER_TYPE_LABELS, MAX_APPROVAL_STAGES, approvalDocument, approvalHref, type ApproverType } from "./catalog";

/**
 * The approval engine shared by every module.
 *
 * A record with an active scheme gets an ApprovalRequest when it is raised.
 * Each module's own "approve" calls approvalGate() first: the person must be
 * the current stage's approver; their approval moves the request to the next
 * stage, and only the last one lets the module carry out the approval.
 * Rejecting at any stage closes the request and lets the module reject.
 * Without a scheme (or with "Approval Req." off) everything works as before.
 *
 * Safeguards:
 * - Nobody approves their own request (only the workspace owner may, and it
 *   is recorded as an owner override).
 * - A record changed after it was sent (amount, lines, dates…) starts again
 *   from stage 1: its fingerprint no longer matches the request's.
 * - A stage nobody can act on (no reporting manager, approver disabled or the
 *   requester themselves, empty or inactive group) goes to the workspace
 *   owner rather than being skipped, so approval is never silently bypassed.
 *   Only a stage under its amount limit is skipped.
 * - Two approvers deciding the same stage at once: the second is refused.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

const d = (v: unknown) => new Decimal(v ? String(v) : "0");
const isOwner = (ctx: AuthContext) => ctx.permissions.includes("*");
const oid = (v: unknown) => (v ? new Types.ObjectId(String(v)) : null);
/** The document belongs to a product this workspace has. */
const inProducts = (ctx: AuthContext, document: string) => {
  const p = approvalDocument(document)?.product;
  return Boolean(p && ctx.products.includes(p));
};

export interface ApprovalRecord {
  id: Types.ObjectId | string;
  number?: string;
  summary?: string;
  /** Decimal string; compared with a stage's "only if more than" limit. */
  amount?: string | null;
  /** HR: whose request it is. ERP: left out, found from requestedByUserId. */
  employeeId?: Types.ObjectId | string | null;
  requestedByUserId?: Types.ObjectId | string | null;
  /** What is being approved, from approvalFingerprint(); a change restarts approval. */
  fingerprint?: string;
}

/** A short stable hash of what is being approved (amount, party, lines, dates…). */
export function approvalFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts ?? null)).digest("hex").slice(0, 32);
}

/** "1. Specific User (Asha Rao) if > ₹5000.00", for history and lists. */
function describeStages(stages: AnyDoc[], users: Map<string, string>, groups: Map<string, string>): string[] {
  return stages.map((st, i) => {
    const who = st.userId ? users.get(String(st.userId)) ?? "removed user" : st.groupId ? groups.get(String(st.groupId)) ?? "removed group" : "";
    return `${i + 1}. ${APPROVER_TYPE_LABELS[st.approverType as ApproverType]}${who ? ` (${who})` : ""}${st.minAmount != null ? ` if > ₹${d(st.minAmount).toFixed(2)}` : ""}`;
  });
}

export type GateResult = { proceed: true } | { proceed: false; message: string };

/* ------------------------------------------------------------------ */
/* Schemes                                                             */
/* ------------------------------------------------------------------ */

const stageInput = z.object({
  approverType: z.enum(APPROVER_TYPES),
  userId: z.string().trim().regex(/^[a-f\d]{24}$/i).nullish(),
  groupId: z.string().trim().regex(/^[a-f\d]{24}$/i).nullish(),
  onlyIfAmountExceeds: z.boolean().optional().default(false),
  minAmount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter the amount limit").nullish(),
});

export const schemeInputSchema = z.object({
  approvalRequired: z.boolean(),
  stages: z.array(stageInput).max(MAX_APPROVAL_STAGES, `At most ${MAX_APPROVAL_STAGES} stages`),
});

async function userNames(businessId: Types.ObjectId, ids: unknown[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const users = await User.find({ businessId, _id: { $in: list } }, { name: 1 }).lean<AnyDoc[]>();
  return new Map(users.map((u) => [String(u._id), u.name as string]));
}

async function groupNames(businessId: Types.ObjectId, ids: unknown[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const groups = await ApprovalUserGroup.find({ businessId, _id: { $in: list } }, { name: 1 }).lean<AnyDoc[]>();
  return new Map(groups.map((g) => [String(g._id), g.name as string]));
}

function schemeOut(s: AnyDoc | null, document: string, users: Map<string, string>, groups: Map<string, string>) {
  return {
    document,
    label: approvalDocument(document)?.label ?? document,
    configured: Boolean(s),
    approvalRequired: Boolean(s?.approvalRequired),
    stages: (s?.stages ?? []).map((st: AnyDoc) => ({
      approverType: st.approverType as ApproverType,
      userId: st.userId ? String(st.userId) : null,
      userName: st.userId ? users.get(String(st.userId)) ?? "" : "",
      groupId: st.groupId ? String(st.groupId) : null,
      groupName: st.groupId ? groups.get(String(st.groupId)) ?? "" : "",
      onlyIfAmountExceeds: st.minAmount != null,
      minAmount: st.minAmount != null ? d(st.minAmount).toFixed(2) : null,
    })),
    updatedAt: s?.updatedAt ?? null,
  };
}

/** Every document this workspace can set a scheme for, with its scheme if one is saved. */
export async function listSchemes(ctx: AuthContext) {
  const docs = APPROVAL_DOCUMENTS.filter((x) => ctx.products.includes(x.product));
  const schemes = await ApprovalScheme.find({ businessId: ctx.businessId }).lean<AnyDoc[]>();
  const byDoc = new Map(schemes.map((s) => [s.document as string, s]));
  const allStages = schemes.flatMap((s) => s.stages ?? []);
  const [users, groups] = await Promise.all([
    userNames(ctx.businessId, allStages.map((x: AnyDoc) => x.userId)),
    groupNames(ctx.businessId, allStages.map((x: AnyDoc) => x.groupId)),
  ]);
  return docs.map((x) => ({ ...schemeOut(byDoc.get(x.key) ?? null, x.key, users, groups), module: x.module, amount: x.amount }));
}

export async function getScheme(ctx: AuthContext, document: string) {
  if (!approvalDocument(document)) throw AppError.notFound("Unknown document");
  const s = await ApprovalScheme.findOne({ businessId: ctx.businessId, document }).lean<AnyDoc>();
  const stages = s?.stages ?? [];
  const [users, groups] = await Promise.all([userNames(ctx.businessId, stages.map((x: AnyDoc) => x.userId)), groupNames(ctx.businessId, stages.map((x: AnyDoc) => x.groupId))]);
  return schemeOut(s, document, users, groups);
}

export async function saveScheme(ctx: AuthContext, document: string, input: z.infer<typeof schemeInputSchema>) {
  const def = approvalDocument(document);
  if (!def) throw AppError.notFound("Unknown document");
  if (input.approvalRequired && input.stages.length === 0) throw AppError.badRequest("Choose the number of stages", "NO_STAGES");

  const stages = [];
  for (const [i, st] of input.stages.entries()) {
    const n = i + 1;
    let userId: Types.ObjectId | null = null;
    let groupId: Types.ObjectId | null = null;
    if (st.approverType === "SPECIFIC_USER") {
      if (!st.userId) throw AppError.badRequest(`Stage-${n}: choose the user`, "STAGE_USER_REQUIRED");
      const u = await User.exists({ _id: st.userId, businessId: ctx.businessId });
      if (!u) throw AppError.badRequest(`Stage-${n}: that user is not in this workspace`, "STAGE_USER_INVALID");
      userId = new Types.ObjectId(st.userId);
    }
    if (st.approverType === "USER_GROUP") {
      if (!st.groupId) throw AppError.badRequest(`Stage-${n}: choose the user group`, "STAGE_GROUP_REQUIRED");
      const g = await ApprovalUserGroup.exists({ _id: st.groupId, businessId: ctx.businessId, deletedAt: null });
      if (!g) throw AppError.badRequest(`Stage-${n}: that user group no longer exists`, "STAGE_GROUP_INVALID");
      groupId = new Types.ObjectId(st.groupId);
    }
    let minAmount = null;
    if (st.onlyIfAmountExceeds) {
      if (!def.amount) throw AppError.badRequest(`Stage-${n}: ${def.label} has no amount to compare`, "NO_AMOUNT");
      if (!st.minAmount) throw AppError.badRequest(`Stage-${n}: enter the amount limit`, "STAGE_LIMIT_REQUIRED");
      minAmount = toDecimal128(new Decimal(st.minAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    }
    stages.push({ approverType: st.approverType, userId, groupId, minAmount });
  }

  const before = await ApprovalScheme.findOne({ businessId: ctx.businessId, document }).lean<AnyDoc>();
  const named = [...(before?.stages ?? []), ...stages];
  const [nUsers, nGroups] = await Promise.all([
    userNames(ctx.businessId, named.map((x: AnyDoc) => x.userId)),
    groupNames(ctx.businessId, named.map((x: AnyDoc) => x.groupId)),
  ]);
  await ApprovalScheme.updateOne(
    { businessId: ctx.businessId, document },
    { $set: { approvalRequired: input.approvalRequired, stages, updatedBy: ctx.userId }, $setOnInsert: { createdBy: ctx.userId } },
    { upsert: true }
  );
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: before ? "UPDATE" : "CREATE",
    module: "approvals",
    documentType: "ApprovalScheme",
    // Full before/after in words, so the History panel can show exactly what changed.
    oldValue: before ? { document, approvalRequired: Boolean(before.approvalRequired), stages: describeStages(before.stages ?? [], nUsers, nGroups) } : undefined,
    newValue: { document, approvalRequired: input.approvalRequired, stages: describeStages(stages, nUsers, nGroups) },
  });
  return getScheme(ctx, document);
}

/* ------------------------------------------------------------------ */
/* User groups                                                         */
/* ------------------------------------------------------------------ */

export const groupInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  description: z.string().trim().max(300).optional().default(""),
  userIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1, "Add at least one user").max(200),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional().default("ACTIVE"),
});

export async function listGroups(ctx: AuthContext) {
  const groups = await ApprovalUserGroup.find({ businessId: ctx.businessId, deletedAt: null }).sort({ name: 1 }).lean<AnyDoc[]>();
  const names = await userNames(ctx.businessId, groups.flatMap((g) => g.userIds ?? []));
  return groups.map((g) => ({
    id: String(g._id),
    name: g.name,
    description: g.description ?? "",
    status: g.status,
    users: (g.userIds ?? []).map((u: unknown) => ({ id: String(u), name: names.get(String(u)) ?? "(removed user)" })),
  }));
}

async function validUserIds(ctx: AuthContext, ids: string[]) {
  const unique = [...new Set(ids)];
  const found = await User.countDocuments({ businessId: ctx.businessId, _id: { $in: unique } });
  if (found !== unique.length) throw AppError.badRequest("Some of the chosen users are not in this workspace", "GROUP_USER_INVALID");
  return unique.map((x) => new Types.ObjectId(x));
}

export async function createGroup(ctx: AuthContext, input: z.infer<typeof groupInputSchema>) {
  const g = await ApprovalUserGroup.create({ businessId: ctx.businessId, name: input.name, description: input.description, status: input.status, userIds: await validUserIds(ctx, input.userIds), createdBy: ctx.userId, updatedBy: ctx.userId });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "approvals", documentType: "ApprovalUserGroup", documentId: g._id, newValue: { name: input.name, users: input.userIds.length } });
  return { id: String(g._id) };
}

export async function updateGroup(ctx: AuthContext, id: string, input: z.infer<typeof groupInputSchema>) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("User group not found");
  const before = await ApprovalUserGroup.findOne({ _id: id, businessId: ctx.businessId, deletedAt: null }).lean<AnyDoc>();
  if (!before) throw AppError.notFound("User group not found");
  await ApprovalUserGroup.updateOne({ _id: id, businessId: ctx.businessId }, { $set: { name: input.name, description: input.description, status: input.status, userIds: await validUserIds(ctx, input.userIds), updatedBy: ctx.userId } });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "approvals", documentType: "ApprovalUserGroup", documentId: before._id, oldValue: { name: before.name, users: (before.userIds ?? []).length }, newValue: { name: input.name, users: input.userIds.length } });
  return { id };
}

/** Soft delete; refused while a scheme still gives a stage to the group. */
export async function deleteGroup(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("User group not found");
  const used = await ApprovalScheme.findOne({ businessId: ctx.businessId, "stages.groupId": new Types.ObjectId(id) }, { document: 1 }).lean<AnyDoc>();
  if (used) throw AppError.conflict(`The ${approvalDocument(used.document)?.label ?? used.document} approval scheme uses this group. Change it first.`, "GROUP_IN_USE");
  const res = await ApprovalUserGroup.updateOne({ _id: id, businessId: ctx.businessId, deletedAt: null }, { $set: { deletedAt: new Date(), updatedBy: ctx.userId } });
  if (!res.matchedCount) throw AppError.notFound("User group not found");
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "DELETE", module: "approvals", documentType: "ApprovalUserGroup", documentId: new Types.ObjectId(id) });
}

/** Active users of the workspace, for the user pickers. */
export async function pickableUsers(ctx: AuthContext) {
  const users = await User.find({ businessId: ctx.businessId, status: { $ne: "DISABLED" } }, { name: 1, email: 1 }).sort({ name: 1 }).lean<AnyDoc[]>();
  return users.map((u) => ({ id: String(u._id), name: u.name as string, email: u.email as string }));
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/** Who changed which scheme when, newest first; one document or all. */
export async function schemeHistory(ctx: AuthContext, document?: string) {
  const allowed = APPROVAL_DOCUMENTS.filter((x) => ctx.products.includes(x.product)).map((x) => x.key as string);
  const filter: Record<string, unknown> = { businessId: ctx.businessId, module: "approvals", documentType: "ApprovalScheme" };
  filter["newValue.document"] = document && allowed.includes(document) ? document : { $in: allowed };
  const rows = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(200).lean<AnyDoc[]>();
  const names = await userNames(ctx.businessId, rows.map((r) => r.userId));
  const words = (v: AnyDoc) => (Array.isArray(v?.stages) ? v.stages.map((s: unknown) => (typeof s === "string" ? s : APPROVER_TYPE_LABELS[s as ApproverType] ?? String(s))) : typeof v?.stages === "number" ? [`${v.stages} stage(s)`] : []);
  return rows.map((r) => ({
    id: String(r._id),
    at: r.createdAt,
    by: names.get(String(r.userId)) ?? "Unknown user",
    document: r.newValue?.document ?? "",
    documentLabel: approvalDocument(r.newValue?.document)?.label ?? r.newValue?.document ?? "",
    action: r.oldValue ? "Changed" : "Created",
    before: r.oldValue ? { approvalRequired: Boolean(r.oldValue.approvalRequired), stages: words(r.oldValue) } : null,
    after: { approvalRequired: Boolean(r.newValue?.approvalRequired), stages: words(r.newValue) },
  }));
}

/** Whether this user may see a request's history: approvals viewers, the requester, anyone named on a stage, or a member of a stage's group. */
async function maySee(ctx: AuthContext, req: AnyDoc): Promise<boolean> {
  if (isOwner(ctx) || ctx.permissions.includes("approvals.view")) return true;
  const me = String(ctx.userId);
  if (String(req.requestedByUserId) === me) return true;
  if ((req.currentApproverUserIds ?? []).some((u: unknown) => String(u) === me)) return true;
  if ((req.stages ?? []).some((s: AnyDoc) => String(s.userId) === me || String(s.decidedByUserId) === me)) return true;
  const groupIds = (req.stages ?? []).map((s: AnyDoc) => s.groupId).filter(Boolean);
  return groupIds.length > 0 && Boolean(await ApprovalUserGroup.exists({ businessId: ctx.businessId, _id: { $in: groupIds }, userIds: ctx.userId }));
}

/** Every approval round of the request's record (restarts included), newest first, with each stage's decision. */
export async function requestHistory(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (!(await maySee(ctx, req))) throw AppError.forbidden("You are not part of this approval", "APPROVAL_PRIVATE");
  const rounds = await ApprovalRequest.find({ businessId: ctx.businessId, document: req.document, recordId: req.recordId }).sort({ createdAt: -1 }).lean<AnyDoc[]>();
  const allStages = rounds.flatMap((r) => r.stages ?? []);
  const [users, groups] = await Promise.all([
    userNames(ctx.businessId, allStages.map((s: AnyDoc) => s.userId)),
    groupNames(ctx.businessId, allStages.map((s: AnyDoc) => s.groupId)),
  ]);
  return {
    document: req.document,
    documentLabel: approvalDocument(req.document)?.label ?? req.document,
    recordNumber: req.recordNumber,
    href: approvalHref(req.document, String(req.recordId)),
    rounds: rounds.map((r) => ({
      id: String(r._id),
      status: r.status,
      closedReason: r.closedReason ?? "",
      requestedByName: r.requestedByName,
      requestedAt: r.createdAt,
      updatedAt: r.updatedAt,
      amount: r.amount != null ? d(r.amount).toFixed(2) : null,
      summary: r.summary,
      stages: (r.stages ?? []).map((s: AnyDoc) => ({
        stage: s.stage,
        approver: `${APPROVER_TYPE_LABELS[s.approverType as ApproverType]}${s.userId ? ` (${users.get(String(s.userId)) ?? "removed user"})` : s.groupId ? ` (${groups.get(String(s.groupId)) ?? "removed group"})` : ""}`,
        limit: s.minAmount != null ? d(s.minAmount).toFixed(2) : null,
        status: s.status,
        decidedByName: s.decidedByName,
        decidedAt: s.decidedAt,
        note: s.note,
        skippedReason: s.skippedReason,
        escalatedReason: s.escalatedReason ?? "",
        override: Boolean(s.override),
      })),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

async function activeScheme(businessId: Types.ObjectId, document: string) {
  const s = await ApprovalScheme.findOne({ businessId, document }).lean<AnyDoc>();
  return s && s.approvalRequired && (s.stages ?? []).length > 0 ? s : null;
}

async function latestRequest(businessId: Types.ObjectId, document: string, recordId: unknown) {
  return ApprovalRequest.findOne({ businessId, document, recordId: oid(recordId) }).sort({ createdAt: -1 });
}

/** Active users holding the owner role (permission "*"): who a stage goes to when nobody else can act on it. */
async function ownerUserIds(businessId: Types.ObjectId): Promise<Types.ObjectId[]> {
  const roles = await Role.find({ businessId, permissions: "*" }, { _id: 1 }).lean<AnyDoc[]>();
  if (!roles.length) return [];
  const users = await User.find({ businessId, roleId: { $in: roles.map((r) => r._id) }, status: "ACTIVE" }, { _id: 1 }).lean<AnyDoc[]>();
  return users.map((u) => u._id as Types.ObjectId);
}

/** Saves a request, turning a lost race (someone else decided first) into a clear conflict. */
async function saveRequest(req: AnyDoc) {
  try {
    await req.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) {
      throw AppError.conflict("Someone else decided this approval a moment ago. Refresh to see where it stands.", "APPROVAL_CONFLICT");
    }
    throw err;
  }
}

/** The user id of the reporting manager of the request's employee, if there is one. */
async function reportingManagerUserId(businessId: Types.ObjectId, employeeId: unknown): Promise<Types.ObjectId | null> {
  if (!employeeId) return null;
  const emp = await Employee.findOne({ _id: employeeId, businessId }, { reportingManagerId: 1 }).lean<AnyDoc>();
  if (!emp?.reportingManagerId) return null;
  const mgr = await Employee.findOne({ _id: emp.reportingManagerId, businessId, deletedAt: null }, { userId: 1 }).lean<AnyDoc>();
  return mgr?.userId ? new Types.ObjectId(String(mgr.userId)) : null;
}

/**
 * Moves the request to the first stage from `from` that applies. Only a
 * stage under its amount limit is skipped. A stage nobody can act on goes to
 * the workspace owner (escalatedReason says why). Returns false when no
 * stage is left.
 */
async function activateFrom(req: AnyDoc, from: number): Promise<boolean> {
  const requester = String(req.requestedByUserId ?? "");
  for (let i = from; i < req.stages.length; i++) {
    const st = req.stages[i];
    if (st.minAmount != null && req.amount != null && !d(req.amount).gt(d(st.minAmount))) {
      st.status = "SKIPPED";
      st.skippedReason = `Amount is not more than ${d(st.minAmount).toFixed(2)}`;
      continue;
    }
    let users: Types.ObjectId[] = [];
    let group: Types.ObjectId | null = null;
    let escalate = "";
    if (st.approverType === "REPORTING_MANAGER") {
      const mgr = await reportingManagerUserId(req.businessId, req.employeeId);
      if (!mgr) escalate = "No reporting manager with a login is set";
      else if (String(mgr) === requester) escalate = "The reporting manager raised this request";
      else users = [mgr];
    } else if (st.approverType === "SPECIFIC_USER") {
      const u = st.userId ? await User.findOne({ _id: st.userId, businessId: req.businessId }, { status: 1 }).lean<AnyDoc>() : null;
      if (!u || u.status === "DISABLED") escalate = "The named approver no longer has an active login";
      else if (String(st.userId) === requester) escalate = "The named approver raised this request";
      else users = [st.userId];
    } else {
      const g = st.groupId ? await ApprovalUserGroup.findOne({ _id: st.groupId, businessId: req.businessId, deletedAt: null, status: "ACTIVE" }, { userIds: 1 }).lean<AnyDoc>() : null;
      const others = (g?.userIds ?? []).filter((u: unknown) => String(u) !== requester);
      const active = others.length ? await User.countDocuments({ businessId: req.businessId, _id: { $in: others }, status: { $ne: "DISABLED" } }) : 0;
      if (!g) escalate = "The user group is inactive or deleted";
      else if (active === 0) escalate = "No one else in the user group has an active login";
      else group = st.groupId;
    }
    if (escalate) {
      users = await ownerUserIds(req.businessId);
      group = null;
      st.escalatedReason = `${escalate}, so the workspace owner approves`;
    }
    st.status = "PENDING";
    req.currentStage = st.stage;
    req.currentApproverUserIds = users;
    req.currentGroupId = group;
    return true;
  }
  req.currentStage = 0;
  req.currentApproverUserIds = [];
  req.currentGroupId = null;
  return false;
}

/**
 * Starts approval for a record when its document has an active scheme.
 * Returns the request, or null when no approval is needed (no scheme, or
 * every stage skipped). An open request for the record is reused.
 */
export async function openApproval(ctx: AuthContext, document: string, rec: ApprovalRecord) {
  const scheme = await activeScheme(ctx.businessId, document);
  if (!scheme) return null;
  const open = await ApprovalRequest.findOne({ businessId: ctx.businessId, document, recordId: oid(rec.id), status: "PENDING" });
  if (open) return open;

  const requestedBy = oid(rec.requestedByUserId) ?? ctx.userId;
  let employeeId = oid(rec.employeeId);
  if (!employeeId) {
    const emp = await Employee.findOne({ businessId: ctx.businessId, userId: requestedBy, deletedAt: null }, { _id: 1 }).lean<AnyDoc>();
    employeeId = emp ? emp._id : null;
  }
  const names = await userNames(ctx.businessId, [requestedBy]);
  const req = new ApprovalRequest({
    businessId: ctx.businessId,
    document,
    recordId: oid(rec.id),
    recordNumber: rec.number ?? "",
    summary: rec.summary ?? "",
    amount: rec.amount != null ? toDecimal128(new Decimal(rec.amount)) : null,
    requestedByUserId: requestedBy,
    requestedByName: names.get(String(requestedBy)) ?? "",
    employeeId,
    fingerprint: rec.fingerprint ?? "",
    status: "PENDING",
    stages: scheme.stages.map((s: AnyDoc, i: number) => ({ stage: i + 1, approverType: s.approverType, userId: s.userId, groupId: s.groupId, minAmount: s.minAmount, status: "WAITING" })),
  });
  if (!(await activateFrom(req, 0))) {
    // Nothing applies (all under limit / no manager): treat as approved straight away.
    req.status = "APPROVED";
    await saveRequest(req);
    return null;
  }
  await saveRequest(req);
  return req;
}

/** Closes a request without a decision (the record changed), keeping its stage history. */
async function supersede(ctx: AuthContext, req: AnyDoc, reason: string) {
  req.status = "CANCELLED";
  req.closedReason = reason;
  req.currentApproverUserIds = [];
  req.currentGroupId = null;
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "approvals", documentType: approvalDocument(req.document)?.label ?? req.document, documentId: req.recordId, reason });
}

const CHANGED = "Changed after it was sent for approval, so approval started again from stage 1";

/**
 * After a record is edited: if what was sent for approval changed, the open
 * request is closed and (with `reopen`) a fresh one starts from stage 1.
 * Returns the new request, or null when nothing changed or none was reopened.
 */
export async function restartIfChanged(ctx: AuthContext, document: string, rec: ApprovalRecord, reopen: boolean) {
  if (!rec.fingerprint) return null;
  const open = await ApprovalRequest.findOne({ businessId: ctx.businessId, document, recordId: oid(rec.id), status: "PENDING" });
  if (!open || !open.fingerprint || open.fingerprint === rec.fingerprint) return null;
  await supersede(ctx, open, CHANGED);
  return reopen ? openApproval(ctx, document, rec) : null;
}

/** Whether this user is the current stage's approver by name or group (the owner's override aside). */
async function isNamedApprover(ctx: AuthContext, req: AnyDoc): Promise<boolean> {
  if (String(req.requestedByUserId) === String(ctx.userId)) return false;
  if ((req.currentApproverUserIds ?? []).some((u: unknown) => String(u) === String(ctx.userId))) return true;
  if (req.currentGroupId) {
    return Boolean(await ApprovalUserGroup.exists({ _id: req.currentGroupId, businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", userIds: ctx.userId }));
  }
  return false;
}

/** Whether this user may act on the request's current stage: its approver, or the workspace owner (recorded as an override). */
async function mayAct(ctx: AuthContext, req: AnyDoc): Promise<boolean> {
  return isOwner(ctx) || (await isNamedApprover(ctx, req));
}

/** "Stage-2 · Reporting Manager (Asha Rao)" */
export async function currentApproverLabel(businessId: Types.ObjectId, req: AnyDoc): Promise<string> {
  const st = req.stages.find((s: AnyDoc) => s.stage === req.currentStage);
  if (!st) return "";
  let who = "";
  if (req.currentGroupId) who = (await groupNames(businessId, [req.currentGroupId])).get(String(req.currentGroupId)) ?? "";
  else if (req.currentApproverUserIds?.length) who = [...(await userNames(businessId, req.currentApproverUserIds)).values()].join(", ");
  return `Stage-${st.stage} · ${APPROVER_TYPE_LABELS[st.approverType as ApproverType]}${who ? ` (${who})` : ""}`;
}

/**
 * Called by a module before it approves or rejects a record.
 * - No active scheme: proceed (old behaviour).
 * - Someone who is not the current approver: if the request was only now
 *   opened, they have just sent it for approval; otherwise they are refused.
 * - Approve on a stage with more after it: records the stage, does not proceed.
 * - Approve on the last stage, or reject on any: proceed.
 */
export async function approvalGate(ctx: AuthContext, document: string, rec: ApprovalRecord, action: "approve" | "reject", note = ""): Promise<GateResult> {
  const scheme = await activeScheme(ctx.businessId, document);
  let req = await latestRequest(ctx.businessId, document, rec.id);
  if (!scheme) {
    if (req?.status === "PENDING") await ApprovalRequest.updateOne({ _id: req._id }, { $set: { status: "CANCELLED" } });
    return { proceed: true };
  }
  // Changed since it was sent: what was approved so far no longer counts.
  let changed = false;
  if (req && (req.status === "PENDING" || req.status === "APPROVED") && rec.fingerprint && req.fingerprint && req.fingerprint !== rec.fingerprint) {
    await supersede(ctx, req, CHANGED);
    req = null;
    changed = true;
  }

  // A finished approval whose module step failed afterwards (e.g. balance check) can be retried, for the same content only.
  if (req?.status === "APPROVED" && action === "approve") return { proceed: true };
  if (req?.status === "REJECTED" && action === "reject") return { proceed: true };

  let justOpened = false;
  if (!req || req.status !== "PENDING") {
    req = await openApproval(ctx, document, rec);
    if (!req) return { proceed: true };
    justOpened = true;
  }

  // The approver acted on the old content: they review the new one first.
  if (changed) {
    return { proceed: false, message: `This record changed after it was sent for approval, so approval started again. Waiting for ${await currentApproverLabel(ctx.businessId, req)}.` };
  }

  if (!(await mayAct(ctx, req))) {
    const waiting = await currentApproverLabel(ctx.businessId, req);
    if (justOpened) return { proceed: false, message: `Sent for approval. Waiting for ${waiting}.` };
    const own = String(req.requestedByUserId) === String(ctx.userId);
    throw AppError.forbidden(own ? `You raised this request, so someone else must approve it. Waiting for ${waiting}.` : `This follows the approval scheme. Waiting for ${waiting}.`, "APPROVAL_NOT_YOURS");
  }

  const me = (await userNames(ctx.businessId, [ctx.userId])).get(String(ctx.userId)) ?? "";
  const st = req.stages.find((s: AnyDoc) => s.stage === req.currentStage);
  st.status = action === "approve" ? "APPROVED" : "REJECTED";
  st.decidedByUserId = ctx.userId;
  st.decidedByName = me;
  st.decidedAt = new Date();
  st.note = note;
  st.override = !(await isNamedApprover(ctx, req));

  if (action === "reject") {
    req.status = "REJECTED";
    req.currentApproverUserIds = [];
    req.currentGroupId = null;
    await saveRequest(req);
    await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "REJECT", module: "approvals", documentType: approvalDocument(document)?.label ?? document, documentId: req.recordId, newValue: { stage: st.stage, ownerOverride: st.override }, reason: note || undefined });
    return { proceed: true };
  }

  const more = await activateFrom(req, req.stages.indexOf(st) + 1);
  if (!more) req.status = "APPROVED";
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "APPROVE", module: "approvals", documentType: approvalDocument(document)?.label ?? document, documentId: req.recordId, newValue: { stage: st.stage, final: !more, ownerOverride: st.override }, reason: note || undefined });
  if (more) return { proceed: false, message: `Stage-${st.stage} approved. Now waiting for ${await currentApproverLabel(ctx.businessId, req)}.` };
  return { proceed: true };
}

/** Closes an open request when its record is withdrawn, cancelled or sent back. */
export async function cancelApproval(businessId: Types.ObjectId, document: string, recordId: unknown) {
  await ApprovalRequest.updateMany({ businessId, document, recordId: oid(recordId), status: "PENDING" }, { $set: { status: "CANCELLED", currentApproverUserIds: [], currentGroupId: null } });
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export const queueSchema = z.object({
  scope: z.enum(["mine", "all", "raised"]).default("mine"),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).default("PENDING"),
  document: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export async function approvalQueue(ctx: AuthContext, params: z.infer<typeof queueSchema>, canSeeAll: boolean) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, status: params.status };
  const allowedDocs = APPROVAL_DOCUMENTS.filter((x) => ctx.products.includes(x.product)).map((x) => x.key as string);
  filter.document = params.document && allowedDocs.includes(params.document) ? params.document : { $in: allowedDocs };
  if (params.scope === "all" && !canSeeAll) throw AppError.forbidden("Missing required permission: approvals.view");
  if (params.scope === "raised") filter.requestedByUserId = ctx.userId;
  else if (params.scope === "mine") {
    const myGroups = await ApprovalUserGroup.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", userIds: ctx.userId }, { _id: 1 }).lean<AnyDoc[]>();
    filter.status = "PENDING";
    filter.requestedByUserId = { $ne: ctx.userId };
    filter.$or = [{ currentApproverUserIds: ctx.userId }, { currentGroupId: { $in: myGroups.map((g) => g._id) } }];
  }
  const [rows, total] = await Promise.all([
    ApprovalRequest.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    ApprovalRequest.countDocuments(filter),
  ]);
  const items = [];
  for (const r of rows) {
    items.push({
      id: String(r._id),
      document: r.document,
      documentLabel: approvalDocument(r.document)?.label ?? r.document,
      recordId: String(r.recordId),
      href: approvalHref(r.document, String(r.recordId)),
      recordNumber: r.recordNumber,
      summary: r.summary,
      amount: r.amount != null ? d(r.amount).toFixed(2) : null,
      requestedByName: r.requestedByName,
      requestedAt: r.createdAt,
      status: r.status,
      waitingFor: r.status === "PENDING" ? await currentApproverLabel(ctx.businessId, r) : "",
      canAct: r.status === "PENDING" && (await mayAct(ctx, r)),
      closedReason: r.closedReason ?? "",
      stages: (r.stages ?? []).map((s: AnyDoc) => ({
        stage: s.stage,
        approverType: s.approverType,
        status: s.status,
        decidedByName: s.decidedByName,
        decidedAt: s.decidedAt,
        note: s.note,
        skippedReason: s.skippedReason,
        escalatedReason: s.escalatedReason ?? "",
        override: Boolean(s.override),
      })),
    });
  }
  return { items, total, page: params.page, pageSize: params.pageSize };
}

/** The request an approver is acting on from the queue, after checking they may. */
export async function requestForAction(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId });
  // A product the workspace no longer has can't be acted on.
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (req.status !== "PENDING") throw AppError.conflict(`This approval is already ${String(req.status).toLowerCase()}`, "APPROVAL_CLOSED");
  if (!(await mayAct(ctx, req))) throw AppError.forbidden(`Waiting for ${await currentApproverLabel(ctx.businessId, req)}.`, "APPROVAL_NOT_YOURS");
  return req;
}

/** How many approvals are waiting for this user (sidebar badge, dashboard). */
export async function pendingForMeCount(ctx: AuthContext) {
  const myGroups = await ApprovalUserGroup.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", userIds: ctx.userId }, { _id: 1 }).lean<AnyDoc[]>();
  return ApprovalRequest.countDocuments({
    businessId: ctx.businessId,
    status: "PENDING",
    requestedByUserId: { $ne: ctx.userId },
    $or: [{ currentApproverUserIds: ctx.userId }, { currentGroupId: { $in: myGroups.map((g) => g._id) } }],
  });
}

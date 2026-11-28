import mongoose, { Types } from "mongoose";
import { createHash } from "crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { ApprovalScheme, ApprovalUserGroup, ApprovalRequest, Notification } from "@/models/approval";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { AuditLog } from "@/models/AuditLog";
import { Employee, HrDepartment } from "@/models/hr";
import { MasterCounter } from "@/models/MasterCounter";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import {
  APPROVAL_DOCUMENTS,
  APPROVER_TYPES,
  APPROVER_TYPE_LABELS,
  APPROVAL_DISPLAY_STATUSES,
  MAX_APPROVAL_STAGES,
  approvalDocument,
  approvalHref,
  type ApproverType,
  type ApprovalDisplayStatus,
  type HeldResult,
} from "./catalog";

/**
 * The approval engine shared by every module.
 *
 * Records (leave, claims, invoices, payroll runs…): a record with an active
 * scheme gets an ApprovalRequest when it is raised. Each module's own
 * "approve" calls approvalGate() first: the person must be the current
 * stage's approver; their approval moves the request to the next stage, and
 * only the last one lets the module carry out the approval. Rejecting at any
 * stage closes the request and lets the module reject.
 *
 * Actions (attendance sheets, leave balance changes, salary revisions…): a
 * module calls holdForApproval() before writing. With an active scheme the
 * validated input is stored on the request and the module returns "sent for
 * approval"; the operation runs only when the last stage approves
 * (decideHeldAction, with the operation from executors.ts). Nothing is
 * written before then, so a held change can't be bypassed by calling the
 * API: the API itself holds it.
 *
 * Without a scheme (or with "Approval Req." off) everything works as before.
 *
 * Safeguards:
 * - Nobody approves their own request (only the workspace owner may, and it
 *   is recorded as an owner override).
 * - A record changed after it was sent (amount, lines, dates…) starts again
 *   from stage 1: its fingerprint no longer matches the request's.
 * - A stage nobody can act on (no reporting manager or department head, the
 *   approver disabled or the requester themselves, an empty group or role)
 *   goes to the workspace owner rather than being skipped, so approval is
 *   never silently bypassed. Only a stage under its amount limit is skipped.
 * - Two approvers deciding the same stage at once: the second is refused; an
 *   approved action runs once (executingAt claim).
 * - One open held change per target (employee, sheet, run…) at a time.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;
type Id = Types.ObjectId | string;

const d = (v: unknown) => new Decimal(v ? String(v) : "0");
const isOwner = (ctx: AuthContext) => ctx.permissions.includes("*");
const oid = (v: unknown) => (v ? new Types.ObjectId(String(v)) : null);
/** The document belongs to a product this workspace has. */
const inProducts = (ctx: AuthContext, document: string) => {
  const p = approvalDocument(document)?.product;
  return Boolean(p && ctx.products.includes(p));
};
const allowedDocs = (ctx: AuthContext) => APPROVAL_DOCUMENTS.filter((x) => ctx.products.includes(x.product)).map((x) => x.key as string);
const docLabel = (document: string) => approvalDocument(document)?.label ?? document;

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
  /** Label/value lines shown to the approver. */
  details?: { label: string; value: string }[];
}

/** A short stable hash of what is being approved (amount, party, lines, dates…). */
export function approvalFingerprint(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts ?? null)).digest("hex").slice(0, 32);
}

/** Pending with a stage already approved = partially approved. */
export function displayStatus(req: AnyDoc): ApprovalDisplayStatus {
  if (req.status === "PENDING") return (req.stages ?? []).some((s: AnyDoc) => s.status === "APPROVED") ? "PARTIALLY_APPROVED" : "PENDING_APPROVAL";
  return req.status as ApprovalDisplayStatus;
}

type Names = { users: Map<string, string>; groups: Map<string, string>; roles: Map<string, string> };

function approverWho(st: AnyDoc, n: Names): string {
  if (st.userId) return n.users.get(String(st.userId)) ?? "removed user";
  if (st.groupId) return n.groups.get(String(st.groupId)) ?? "removed group";
  if (st.roleId) return n.roles.get(String(st.roleId)) ?? "removed role";
  return "";
}

/** "1. Specific User (Asha Rao) if > ₹5000.00", for history and lists. */
function describeStages(stages: AnyDoc[], n: Names): string[] {
  return stages.map((st, i) => {
    const who = approverWho(st, n);
    return `${i + 1}. ${APPROVER_TYPE_LABELS[st.approverType as ApproverType]}${who ? ` (${who})` : ""}${st.minAmount != null ? ` if > ₹${d(st.minAmount).toFixed(2)}` : ""}`;
  });
}

export type GateResult = { proceed: true } | { proceed: false; message: string };

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

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

async function roleNames(businessId: Types.ObjectId, ids: unknown[]): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const roles = await Role.find({ businessId, _id: { $in: list } }, { name: 1 }).lean<AnyDoc[]>();
  return new Map(roles.map((r) => [String(r._id), r.name as string]));
}

async function stageNames(businessId: Types.ObjectId, stages: AnyDoc[]): Promise<Names> {
  const [users, groups, roles] = await Promise.all([
    userNames(businessId, stages.map((x) => x.userId)),
    groupNames(businessId, stages.map((x) => x.groupId)),
    roleNames(businessId, stages.map((x) => x.roleId)),
  ]);
  return { users, groups, roles };
}

/* ------------------------------------------------------------------ */
/* Schemes                                                             */
/* ------------------------------------------------------------------ */

const idText = z.string().trim().regex(/^[a-f\d]{24}$/i);
const stageInput = z.object({
  approverType: z.enum(APPROVER_TYPES),
  userId: idText.nullish(),
  groupId: idText.nullish(),
  roleId: idText.nullish(),
  onlyIfAmountExceeds: z.boolean().optional().default(false),
  minAmount: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter the amount limit").nullish(),
});

export const schemeInputSchema = z.object({
  approvalRequired: z.boolean(),
  stages: z.array(stageInput).max(MAX_APPROVAL_STAGES, `At most ${MAX_APPROVAL_STAGES} stages`),
});

function schemeOut(s: AnyDoc | null, document: string, n: Names) {
  const def = approvalDocument(document);
  return {
    document,
    label: docLabel(document),
    group: def?.group ?? "",
    module: def?.module ?? "",
    kind: def?.kind ?? "record",
    amount: Boolean(def?.amount),
    sendBack: Boolean(def?.sendBack),
    trigger: def?.trigger ?? "",
    fallback: def && "fallback" in def ? (def.fallback ?? null) : null,
    fallbackLabel: def && "fallback" in def && def.fallback ? docLabel(def.fallback) : null,
    configured: Boolean(s),
    approvalRequired: Boolean(s?.approvalRequired),
    stages: (s?.stages ?? []).map((st: AnyDoc) => ({
      approverType: st.approverType as ApproverType,
      userId: st.userId ? String(st.userId) : null,
      userName: st.userId ? n.users.get(String(st.userId)) ?? "" : "",
      groupId: st.groupId ? String(st.groupId) : null,
      groupName: st.groupId ? n.groups.get(String(st.groupId)) ?? "" : "",
      roleId: st.roleId ? String(st.roleId) : null,
      roleName: st.roleId ? n.roles.get(String(st.roleId)) ?? "" : "",
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
  const n = await stageNames(ctx.businessId, schemes.flatMap((s) => s.stages ?? []));
  return docs.map((x) => schemeOut(byDoc.get(x.key) ?? null, x.key, n));
}

export async function getScheme(ctx: AuthContext, document: string) {
  if (!approvalDocument(document) || !inProducts(ctx, document)) throw AppError.notFound("Unknown document");
  const s = await ApprovalScheme.findOne({ businessId: ctx.businessId, document }).lean<AnyDoc>();
  return schemeOut(s, document, await stageNames(ctx.businessId, s?.stages ?? []));
}

export async function saveScheme(ctx: AuthContext, document: string, input: z.infer<typeof schemeInputSchema>) {
  const def = approvalDocument(document);
  if (!def || !inProducts(ctx, document)) throw AppError.notFound("Unknown document");
  if (input.approvalRequired && input.stages.length === 0) throw AppError.badRequest("Add at least one stage", "NO_STAGES");

  const stages = [];
  for (const [i, st] of input.stages.entries()) {
    const n = i + 1;
    let userId: Types.ObjectId | null = null;
    let groupId: Types.ObjectId | null = null;
    let roleId: Types.ObjectId | null = null;
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
    if (st.approverType === "DESIGNATED_ROLE") {
      if (!st.roleId) throw AppError.badRequest(`Stage-${n}: choose the role`, "STAGE_ROLE_REQUIRED");
      const r = await Role.exists({ _id: st.roleId, businessId: ctx.businessId });
      if (!r) throw AppError.badRequest(`Stage-${n}: that role is not in this workspace`, "STAGE_ROLE_INVALID");
      roleId = new Types.ObjectId(st.roleId);
    }
    let minAmount = null;
    if (st.onlyIfAmountExceeds) {
      if (!def.amount) throw AppError.badRequest(`Stage-${n}: ${def.label} has no amount to compare`, "NO_AMOUNT");
      if (!st.minAmount) throw AppError.badRequest(`Stage-${n}: enter the amount limit`, "STAGE_LIMIT_REQUIRED");
      minAmount = toDecimal128(new Decimal(st.minAmount).toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
    }
    stages.push({ approverType: st.approverType, userId, groupId, roleId, minAmount });
  }
  // The same named approver twice in a row would approve their own approval.
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1];
    const b = stages[i];
    if (a.approverType === b.approverType && a.approverType === "SPECIFIC_USER" && String(a.userId) === String(b.userId)) {
      throw AppError.badRequest(`Stage-${i} and Stage-${i + 1} name the same user. Choose a different approver for one of them.`, "STAGE_DUPLICATE");
    }
  }

  const before = await ApprovalScheme.findOne({ businessId: ctx.businessId, document }).lean<AnyDoc>();
  const n = await stageNames(ctx.businessId, [...(before?.stages ?? []), ...stages]);
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
    oldValue: before ? { document, approvalRequired: Boolean(before.approvalRequired), stages: describeStages(before.stages ?? [], n) } : undefined,
    newValue: { document, approvalRequired: input.approvalRequired, stages: describeStages(stages, n) },
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
  if (used) throw AppError.conflict(`The ${docLabel(used.document)} approval scheme uses this group. Change it first.`, "GROUP_IN_USE");
  const res = await ApprovalUserGroup.updateOne({ _id: id, businessId: ctx.businessId, deletedAt: null }, { $set: { deletedAt: new Date(), updatedBy: ctx.userId } });
  if (!res.matchedCount) throw AppError.notFound("User group not found");
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "DELETE", module: "approvals", documentType: "ApprovalUserGroup", documentId: new Types.ObjectId(id) });
}

/** Active users of the workspace, for the user pickers. */
export async function pickableUsers(ctx: AuthContext) {
  const users = await User.find({ businessId: ctx.businessId, status: { $ne: "DISABLED" } }, { name: 1, email: 1 }).sort({ name: 1 }).lean<AnyDoc[]>();
  return users.map((u) => ({ id: String(u._id), name: u.name as string, email: u.email as string }));
}

/** Roles of the workspace with how many active users hold each, for the "Designated Role" picker. */
export async function pickableRoles(ctx: AuthContext) {
  const roles = await Role.find({ businessId: ctx.businessId }, { name: 1, permissions: 1 }).sort({ name: 1 }).lean<AnyDoc[]>();
  const counts = await User.aggregate<{ _id: Types.ObjectId; n: number }>([
    { $match: { businessId: ctx.businessId, status: "ACTIVE" } },
    { $group: { _id: "$roleId", n: { $sum: 1 } } },
  ]);
  const byRole = new Map(counts.map((c) => [String(c._id), c.n]));
  return roles.map((r) => ({ id: String(r._id), name: r.name as string, users: byRole.get(String(r._id)) ?? 0, owner: (r.permissions ?? []).includes("*") }));
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

/** Who changed which scheme when, newest first; one document or all. */
export async function schemeHistory(ctx: AuthContext, document?: string) {
  const allowed = allowedDocs(ctx);
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
    documentLabel: docLabel(r.newValue?.document ?? ""),
    action: r.oldValue ? "Changed" : "Created",
    before: r.oldValue ? { approvalRequired: Boolean(r.oldValue.approvalRequired), stages: words(r.oldValue) } : null,
    after: { approvalRequired: Boolean(r.newValue?.approvalRequired), stages: words(r.newValue) },
  }));
}

/** Whether this user may see a request: approvals viewers, the requester, anyone named on a stage or who decided one, a member of a stage's group, or a holder of a stage's role. */
async function maySee(ctx: AuthContext, req: AnyDoc): Promise<boolean> {
  if (isOwner(ctx) || ctx.permissions.includes("approvals.view")) return true;
  const me = String(ctx.userId);
  if (String(req.requestedByUserId) === me) return true;
  if ((req.currentApproverUserIds ?? []).some((u: unknown) => String(u) === me)) return true;
  if ((req.stages ?? []).some((s: AnyDoc) => String(s.userId) === me || String(s.decidedByUserId) === me)) return true;
  if ((req.stages ?? []).some((s: AnyDoc) => s.roleId && String(s.roleId) === String(ctx.roleId))) return true;
  const groupIds = (req.stages ?? []).map((s: AnyDoc) => s.groupId).filter(Boolean);
  return groupIds.length > 0 && Boolean(await ApprovalUserGroup.exists({ businessId: ctx.businessId, _id: { $in: groupIds }, userIds: ctx.userId }));
}

function stageOut(s: AnyDoc, n: Names) {
  const who = approverWho(s, n);
  return {
    stage: s.stage,
    approverType: s.approverType as ApproverType,
    approver: `${APPROVER_TYPE_LABELS[s.approverType as ApproverType]}${who ? ` (${who})` : ""}`,
    limit: s.minAmount != null ? d(s.minAmount).toFixed(2) : null,
    status: s.status,
    decidedByName: s.decidedByName,
    decidedAt: s.decidedAt,
    note: s.note,
    skippedReason: s.skippedReason,
    escalatedReason: s.escalatedReason ?? "",
    override: Boolean(s.override),
  };
}

/** Every approval round of the request's record (restarts and resubmissions included), newest first, with each stage's decision. */
export async function requestHistory(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (!(await maySee(ctx, req))) throw AppError.forbidden("You are not part of this approval", "APPROVAL_PRIVATE");
  const rounds = await ApprovalRequest.find({ businessId: ctx.businessId, document: req.document, recordId: req.recordId }).sort({ createdAt: -1 }).lean<AnyDoc[]>();
  const n = await stageNames(ctx.businessId, rounds.flatMap((r) => r.stages ?? []));
  return {
    document: req.document,
    documentLabel: docLabel(req.document),
    recordNumber: req.recordNumber,
    href: approvalHref(req.document, String(req.recordId)),
    rounds: rounds.map((r) => ({
      id: String(r._id),
      requestNo: r.requestNo ?? "",
      status: r.status,
      displayStatus: displayStatus(r),
      closedReason: r.closedReason ?? "",
      requestedByName: r.requestedByName,
      requestedAt: r.createdAt,
      updatedAt: r.updatedAt,
      amount: r.amount != null ? d(r.amount).toFixed(2) : null,
      summary: r.summary,
      stages: (r.stages ?? []).map((s: AnyDoc) => stageOut(s, n)),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

/** In-app notices. Never allowed to fail the approval itself. */
async function notify(businessId: Types.ObjectId, userIds: unknown[], n: { kind: "APPROVAL_PENDING" | "APPROVAL_DECIDED" | "APPROVAL_COMMENT"; title: string; body?: string; requestId: unknown }) {
  const ids = [...new Set(userIds.filter(Boolean).map(String))];
  if (!ids.length) return;
  try {
    await Notification.insertMany(
      ids.map((u) => ({ businessId, userId: new Types.ObjectId(u), kind: n.kind, title: n.title, body: n.body ?? "", href: `/approvals/queue?open=${String(n.requestId)}`, approvalRequestId: oid(n.requestId) }))
    );
  } catch {
    // A notice that can't be written is not a reason to undo an approval.
  }
}

/** Everyone who may act on the request's current stage, as user ids (group members and role holders included). */
async function currentApproverUserIds(req: AnyDoc): Promise<string[]> {
  const requester = String(req.requestedByUserId ?? "");
  let ids: string[] = (req.currentApproverUserIds ?? []).map(String);
  if (req.currentGroupId) {
    const g = await ApprovalUserGroup.findOne({ _id: req.currentGroupId, businessId: req.businessId }, { userIds: 1 }).lean<AnyDoc>();
    ids = ids.concat((g?.userIds ?? []).map(String));
  }
  if (req.currentRoleId) {
    const us = await User.find({ businessId: req.businessId, roleId: req.currentRoleId, status: "ACTIVE" }, { _id: 1 }).lean<AnyDoc[]>();
    ids = ids.concat(us.map((u) => String(u._id)));
  }
  return [...new Set(ids)].filter((u) => u !== requester);
}

async function notifyApprovers(req: AnyDoc) {
  const ids = await currentApproverUserIds(req);
  const ref = req.requestNo || req.recordNumber;
  await notify(req.businessId, ids, {
    kind: "APPROVAL_PENDING",
    title: `${docLabel(req.document)} ${ref} waits for your approval`,
    body: [req.requestedByName ? `Raised by ${req.requestedByName}` : "", req.summary].filter(Boolean).join(" · "),
    requestId: req._id,
  });
}

async function notifyRequester(req: AnyDoc, verb: string, by: string, note: string) {
  const ref = req.requestNo || req.recordNumber;
  await notify(req.businessId, [req.requestedByUserId], {
    kind: "APPROVAL_DECIDED",
    title: `${docLabel(req.document)} ${ref} ${verb}`,
    body: [by ? `By ${by}` : "", note].filter(Boolean).join(" · "),
    requestId: req._id,
  });
}

export const notificationListSchema = z.object({
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function listNotifications(ctx: AuthContext, params: z.infer<typeof notificationListSchema>) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, userId: ctx.userId };
  if (params.unread === "true") filter.readAt = null;
  const [items, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).limit(params.limit).lean<AnyDoc[]>(),
    Notification.countDocuments({ businessId: ctx.businessId, userId: ctx.userId, readAt: null }),
  ]);
  return {
    unread,
    items: items.map((x) => ({ id: String(x._id), kind: x.kind, title: x.title, body: x.body, href: x.href, read: Boolean(x.readAt), at: x.createdAt })),
  };
}

/** Marks the given notices (or all of them) read. */
export async function markNotificationsRead(ctx: AuthContext, ids: string[] | "all") {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, userId: ctx.userId, readAt: null };
  if (ids !== "all") filter._id = { $in: ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x)) };
  const res = await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return { updated: res.modifiedCount };
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

async function activeScheme(businessId: Types.ObjectId, document: string) {
  const s = await ApprovalScheme.findOne({ businessId, document }).lean<AnyDoc>();
  return s && s.approvalRequired && (s.stages ?? []).length > 0 ? s : null;
}

/** Whether approval applies to the document right now (an active scheme). */
export async function approvalActive(businessId: Types.ObjectId, document: string): Promise<boolean> {
  return Boolean(await activeScheme(businessId, document));
}

/**
 * Which document's scheme governs a record that could fall under a specific
 * document (Medical Claim) or its general one (Expense Claim): the one an
 * open request was raised under; else the specific one if it has an active
 * scheme; else the general one.
 */
export async function governingDocument(businessId: Types.ObjectId, specific: string, recordId?: unknown): Promise<string> {
  const general = approvalDocument(specific)?.fallback;
  if (!general) return specific;
  if (recordId) {
    const latest = await ApprovalRequest.findOne({ businessId, recordId: oid(recordId), document: { $in: [specific, general] } }, { document: 1 }).sort({ createdAt: -1 }).lean<AnyDoc>();
    if (latest) return latest.document;
  }
  return (await activeScheme(businessId, specific)) ? specific : general;
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

async function employeeUserId(businessId: Types.ObjectId, employeeId: unknown): Promise<Types.ObjectId | null> {
  if (!employeeId) return null;
  const e = await Employee.findOne({ _id: employeeId, businessId, deletedAt: null }, { userId: 1 }).lean<AnyDoc>();
  return e?.userId ? new Types.ObjectId(String(e.userId)) : null;
}

/** The user id of the reporting manager of the request's employee, if there is one. */
async function reportingManagerUserId(businessId: Types.ObjectId, employeeId: unknown): Promise<Types.ObjectId | null> {
  if (!employeeId) return null;
  const emp = await Employee.findOne({ _id: employeeId, businessId }, { reportingManagerId: 1 }).lean<AnyDoc>();
  return emp?.reportingManagerId ? employeeUserId(businessId, emp.reportingManagerId) : null;
}

/** The user id of the head of the request's employee's department (HR department master), if set. */
async function departmentHeadUserId(businessId: Types.ObjectId, employeeId: unknown): Promise<Types.ObjectId | null> {
  if (!employeeId) return null;
  const emp = await Employee.findOne({ _id: employeeId, businessId }, { departmentId: 1 }).lean<AnyDoc>();
  if (!emp?.departmentId) return null;
  const dept = await HrDepartment.findOne({ _id: emp.departmentId, businessId, deletedAt: null }, { headEmployeeId: 1 }).lean<AnyDoc>();
  return dept?.headEmployeeId ? employeeUserId(businessId, dept.headEmployeeId) : null;
}

async function activeLogin(businessId: Types.ObjectId, userId: unknown): Promise<boolean> {
  const u = await User.findOne({ _id: userId, businessId }, { status: 1 }).lean<AnyDoc>();
  return Boolean(u && u.status !== "DISABLED");
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
    let role: Types.ObjectId | null = null;
    let escalate = "";
    if (st.approverType === "REPORTING_MANAGER" || st.approverType === "DEPARTMENT_HEAD") {
      const head = st.approverType === "REPORTING_MANAGER";
      const who = head ? await reportingManagerUserId(req.businessId, req.employeeId) : await departmentHeadUserId(req.businessId, req.employeeId);
      const label = head ? "reporting manager" : "department head";
      if (!who) escalate = head ? "No reporting manager with a login is set" : "The department has no head with a login";
      else if (!(await activeLogin(req.businessId, who))) escalate = `The ${label} no longer has an active login`;
      else if (String(who) === requester) escalate = `The ${label} raised this request`;
      else users = [who];
    } else if (st.approverType === "SPECIFIC_USER") {
      if (!st.userId || !(await activeLogin(req.businessId, st.userId))) escalate = "The named approver no longer has an active login";
      else if (String(st.userId) === requester) escalate = "The named approver raised this request";
      else users = [st.userId];
    } else if (st.approverType === "USER_GROUP") {
      const g = st.groupId ? await ApprovalUserGroup.findOne({ _id: st.groupId, businessId: req.businessId, deletedAt: null, status: "ACTIVE" }, { userIds: 1 }).lean<AnyDoc>() : null;
      const others = (g?.userIds ?? []).filter((u: unknown) => String(u) !== requester);
      const active = others.length ? await User.countDocuments({ businessId: req.businessId, _id: { $in: others }, status: { $ne: "DISABLED" } }) : 0;
      if (!g) escalate = "The user group is inactive or deleted";
      else if (active === 0) escalate = "No one else in the user group has an active login";
      else group = st.groupId;
    } else {
      const r = st.roleId ? await Role.exists({ _id: st.roleId, businessId: req.businessId }) : null;
      const holders = r ? await User.countDocuments({ businessId: req.businessId, roleId: st.roleId, status: "ACTIVE", _id: { $ne: oid(requester) } }) : 0;
      if (!r) escalate = "The role no longer exists";
      else if (holders === 0) escalate = "No one else holding the role has an active login";
      else role = st.roleId;
    }
    if (escalate) {
      users = await ownerUserIds(req.businessId);
      group = null;
      role = null;
      st.escalatedReason = `${escalate}, so the workspace owner approves`;
    }
    st.status = "PENDING";
    req.currentStage = st.stage;
    req.currentApproverUserIds = users;
    req.currentGroupId = group;
    req.currentRoleId = role;
    return true;
  }
  req.currentStage = 0;
  req.currentApproverUserIds = [];
  req.currentGroupId = null;
  req.currentRoleId = null;
  return false;
}

async function nextRequestNo(businessId: Types.ObjectId): Promise<string> {
  const counter = await MasterCounter.findOneAndUpdate({ businessId, entityType: "APPROVAL_REQUEST" }, { $inc: { lastNumber: 1 } }, { new: true, upsert: true });
  return `APR-${String(counter.lastNumber).padStart(6, "0")}`;
}

/** A new request in WAITING state for every stage of the scheme (not saved). */
async function newRequest(ctx: AuthContext, scheme: AnyDoc, document: string, rec: ApprovalRecord & { kind?: "record" | "action"; targetKey?: string; payload?: unknown }) {
  const requestedBy = oid(rec.requestedByUserId) ?? ctx.userId;
  let employeeId = oid(rec.employeeId);
  if (!employeeId) {
    const emp = await Employee.findOne({ businessId: ctx.businessId, userId: requestedBy, deletedAt: null }, { _id: 1 }).lean<AnyDoc>();
    employeeId = emp ? emp._id : null;
  }
  let departmentName = "";
  if (employeeId) {
    const emp = await Employee.findOne({ _id: employeeId, businessId: ctx.businessId }, { departmentId: 1 }).lean<AnyDoc>();
    if (emp?.departmentId) departmentName = (await HrDepartment.findOne({ _id: emp.departmentId, businessId: ctx.businessId }, { name: 1 }).lean<AnyDoc>())?.name ?? "";
  }
  const names = await userNames(ctx.businessId, [requestedBy]);
  return new ApprovalRequest({
    businessId: ctx.businessId,
    document,
    kind: rec.kind ?? "record",
    requestNo: await nextRequestNo(ctx.businessId),
    recordId: oid(rec.id),
    recordNumber: rec.number ?? "",
    summary: rec.summary ?? "",
    amount: rec.amount != null && rec.amount !== "" ? toDecimal128(new Decimal(rec.amount)) : null,
    requestedByUserId: requestedBy,
    requestedByName: names.get(String(requestedBy)) ?? "",
    employeeId,
    departmentName,
    fingerprint: rec.fingerprint ?? "",
    targetKey: rec.targetKey ?? "",
    payload: rec.payload ?? null,
    details: (rec.details ?? []).filter((x) => x && x.label).map((x) => ({ label: String(x.label), value: String(x.value ?? "") })),
    status: "PENDING",
    stages: scheme.stages.map((s: AnyDoc, i: number) => ({ stage: i + 1, approverType: s.approverType, userId: s.userId, groupId: s.groupId, roleId: s.roleId ?? null, minAmount: s.minAmount, status: "WAITING" })),
  });
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

  const req = await newRequest(ctx, scheme, document, rec);
  if (!(await activateFrom(req, 0))) {
    // Nothing applies (all under limit): treat as approved straight away.
    req.status = "APPROVED";
    req.decidedAt = new Date();
    await saveRequest(req);
    return null;
  }
  await saveRequest(req);
  await notifyApprovers(req);
  return req;
}

/** Closes a request without a decision (the record changed), keeping its stage history. */
async function supersede(ctx: AuthContext, req: AnyDoc, reason: string) {
  req.status = "CANCELLED";
  req.closedReason = reason;
  req.decidedAt = new Date();
  req.currentApproverUserIds = [];
  req.currentGroupId = null;
  req.currentRoleId = null;
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "approvals", documentType: docLabel(req.document), documentId: req.recordId, reason });
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

/** Whether this user is the current stage's approver by name, group or role (the owner's override aside). */
async function isNamedApprover(ctx: AuthContext, req: AnyDoc): Promise<boolean> {
  if (String(req.requestedByUserId) === String(ctx.userId)) return false;
  if ((req.currentApproverUserIds ?? []).some((u: unknown) => String(u) === String(ctx.userId))) return true;
  if (req.currentRoleId && String(req.currentRoleId) === String(ctx.roleId)) return true;
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
  else if (req.currentRoleId) who = (await roleNames(businessId, [req.currentRoleId])).get(String(req.currentRoleId)) ?? "";
  else if (req.currentApproverUserIds?.length) who = [...(await userNames(businessId, req.currentApproverUserIds)).values()].join(", ");
  return `Stage-${st.stage} · ${APPROVER_TYPE_LABELS[st.approverType as ApproverType]}${who ? ` (${who})` : ""}`;
}

async function myName(ctx: AuthContext): Promise<string> {
  return (await userNames(ctx.businessId, [ctx.userId])).get(String(ctx.userId)) ?? "";
}

/** Records the current stage's decision on the request (not saved). */
async function markStage(ctx: AuthContext, req: AnyDoc, status: "APPROVED" | "REJECTED" | "SENT_BACK", note: string) {
  const st = req.stages.find((s: AnyDoc) => s.stage === req.currentStage);
  if (!st) throw AppError.conflict("This approval has no stage waiting", "APPROVAL_CLOSED");
  st.status = status;
  st.decidedByUserId = ctx.userId;
  st.decidedByName = await myName(ctx);
  st.decidedAt = new Date();
  st.note = note;
  st.override = !(await isNamedApprover(ctx, req));
  if (note) req.comments.push({ userId: ctx.userId, name: st.decidedByName, text: note, stage: st.stage, kind: status === "APPROVED" ? "APPROVE" : status === "REJECTED" ? "REJECT" : "SEND_BACK", at: new Date() });
  return st;
}

function closeRequest(req: AnyDoc, status: "APPROVED" | "REJECTED" | "SENT_BACK" | "CANCELLED") {
  req.status = status;
  req.decidedAt = new Date();
  req.currentApproverUserIds = [];
  req.currentGroupId = null;
  req.currentRoleId = null;
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
    if (req?.status === "PENDING") await ApprovalRequest.updateOne({ _id: req._id }, { $set: { status: "CANCELLED", closedReason: "The approval scheme was switched off", decidedAt: new Date(), currentApproverUserIds: [], currentGroupId: null, currentRoleId: null } });
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

  const st = await markStage(ctx, req, action === "approve" ? "APPROVED" : "REJECTED", note);

  if (action === "reject") {
    closeRequest(req, "REJECTED");
    await saveRequest(req);
    await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "REJECT", module: "approvals", documentType: docLabel(document), documentId: req.recordId, newValue: { requestNo: req.requestNo, stage: st.stage, ownerOverride: st.override }, reason: note || undefined });
    await notifyRequester(req, "was rejected", st.decidedByName, note);
    return { proceed: true };
  }

  const more = await activateFrom(req, req.stages.indexOf(st) + 1);
  if (!more) closeRequest(req, "APPROVED");
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "APPROVE", module: "approvals", documentType: docLabel(document), documentId: req.recordId, newValue: { requestNo: req.requestNo, stage: st.stage, final: !more, ownerOverride: st.override }, reason: note || undefined });
  if (more) {
    await notifyApprovers(req);
    return { proceed: false, message: `Stage-${st.stage} approved. Now waiting for ${await currentApproverLabel(ctx.businessId, req)}.` };
  }
  await notifyRequester(req, "was approved", st.decidedByName, note);
  return { proceed: true };
}

/**
 * Sends a record's open request back to the requester for correction (the
 * module then returns the record to its editable state). The caller has
 * checked, through requestForAction, that this user may act on it.
 */
export async function sendBackRecordApproval(ctx: AuthContext, reqDoc: AnyDoc, note: string) {
  const req = await ApprovalRequest.findOne({ _id: reqDoc._id, businessId: ctx.businessId });
  if (!req || req.status !== "PENDING") throw AppError.conflict("This approval is no longer waiting", "APPROVAL_CLOSED");
  const st = await markStage(ctx, req, "SENT_BACK", note);
  closeRequest(req, "SENT_BACK");
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "approvals", documentType: docLabel(req.document), documentId: req.recordId, newValue: { requestNo: req.requestNo, stage: st.stage, sentBack: true, ownerOverride: st.override }, reason: note });
  await notifyRequester(req, "was sent back for correction", st.decidedByName, note);
  return req;
}

/** Closes an open request when its record is withdrawn, cancelled or sent back. */
export async function cancelApproval(businessId: Types.ObjectId, document: string, recordId: unknown) {
  await ApprovalRequest.updateMany({ businessId, document, recordId: oid(recordId), status: "PENDING" }, { $set: { status: "CANCELLED", decidedAt: new Date(), currentApproverUserIds: [], currentGroupId: null, currentRoleId: null } });
}

/* ------------------------------------------------------------------ */
/* Held actions (maker–checker)                                        */
/* ------------------------------------------------------------------ */

export interface HoldInput {
  document: string;
  /** What the change applies to; one open change per target at a time. */
  targetKey: string;
  /** The record it changes, if it changes one. */
  recordId?: Id | null;
  number?: string;
  summary: string;
  details?: { label: string; value: string }[];
  amount?: string | null;
  /** The employee it is about (Reporting Manager / Department Head stages). */
  employeeId?: Id | null;
  /** The validated input the operation runs with once approved. */
  payload: unknown;
}

/** JSON-safe copy: ids and dates become strings, so the stored payload parses back exactly like the original request body. */
function plain(v: unknown): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

/**
 * Called by a module before it writes an operation a scheme can cover.
 * Returns null when no approval applies (no active scheme, or every stage
 * skipped by its amount limit): the module then goes ahead as before.
 * Otherwise the operation is stored on a new request and the module returns
 * the HeldResult instead of writing anything.
 */
export async function holdForApproval(ctx: AuthContext, input: HoldInput): Promise<HeldResult | null> {
  const def = approvalDocument(input.document);
  if (!def || def.kind !== "action") throw new Error(`holdForApproval: ${input.document} is not an action document`);
  if (!ctx.products.includes(def.product)) return null;
  const scheme = await activeScheme(ctx.businessId, input.document);
  if (!scheme) return null;

  const open = await ApprovalRequest.findOne({ businessId: ctx.businessId, targetKey: input.targetKey, status: "PENDING", kind: "action" }).lean<AnyDoc>();
  if (open) {
    throw AppError.conflict(
      `${docLabel(open.document)} ${open.requestNo} for this is already waiting for approval (${await currentApproverLabel(ctx.businessId, open)}). It must be decided or withdrawn before another change is sent.`,
      "APPROVAL_ALREADY_PENDING"
    );
  }
  const payload = plain(input.payload);
  const req = await newRequest(ctx, scheme, input.document, {
    id: input.recordId ?? new Types.ObjectId(),
    number: input.number,
    summary: input.summary,
    amount: input.amount ?? null,
    employeeId: input.employeeId ?? null,
    details: input.details,
    fingerprint: approvalFingerprint(payload),
    kind: "action",
    targetKey: input.targetKey,
    payload,
  });
  if (!(await activateFrom(req, 0))) return null;

  // A change sent back earlier for the same thing is replaced by this one.
  await ApprovalRequest.updateMany(
    { businessId: ctx.businessId, targetKey: input.targetKey, status: "SENT_BACK", kind: "action" },
    { $set: { closedReason: `Replaced by ${req.requestNo}` } }
  );
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "approvals", documentType: def.label, documentId: req.recordId, newValue: { requestNo: req.requestNo, summary: input.summary, held: true } });
  await notifyApprovers(req);
  const waiting = await currentApproverLabel(ctx.businessId, req);
  return { pendingApproval: true, approvalId: String(req._id), requestNo: req.requestNo, approvalMessage: `Sent for approval as ${req.requestNo}. Nothing changes until it is approved. Waiting for ${waiting}.` };
}

/**
 * For an operation that can fall under several documents, most specific
 * first (a salary change recorded as a promotion…): held under the first
 * one with an active scheme, or null when none has one.
 */
export async function holdUnderFirstActive(ctx: AuthContext, documents: string[], input: Omit<HoldInput, "document">): Promise<HeldResult | null> {
  for (const document of documents) {
    if (await approvalActive(ctx.businessId, document)) return holdForApproval(ctx, { ...input, document });
  }
  return null;
}

/** Runs an approved operation with the approver's context. Returns a line describing what it did. */
export type ActionRunner = (ctx: AuthContext, payload: AnyDoc, req: AnyDoc) => Promise<string | void>;

/** Error codes that mean the held change can no longer be applied as approved; the request is closed rather than left waiting. */
const STALE_CODES = new Set(["APPROVAL_STALE", "PAYROLL_LOCKED", "NOT_FOUND"]);

/**
 * The current approver decides a held action. Approving a middle stage moves
 * it on; approving the last stage runs the operation exactly once, and only
 * if it succeeds is the request marked approved. Rejecting or sending back
 * runs nothing.
 */
export async function decideHeldAction(ctx: AuthContext, reqDoc: AnyDoc, action: "approve" | "reject" | "send-back", note: string, run: ActionRunner) {
  const req = await ApprovalRequest.findOne({ _id: reqDoc._id, businessId: ctx.businessId });
  if (!req || req.status !== "PENDING") throw AppError.conflict("This approval is no longer waiting", "APPROVAL_CLOSED");
  if (req.executingAt && Date.now() - new Date(req.executingAt).getTime() < 10 * 60 * 1000) {
    throw AppError.conflict("This change is being applied right now. Refresh in a moment.", "APPROVAL_CONFLICT");
  }
  const label = docLabel(req.document);

  if (action !== "approve") {
    const st = await markStage(ctx, req, action === "reject" ? "REJECTED" : "SENT_BACK", note);
    closeRequest(req, action === "reject" ? "REJECTED" : "SENT_BACK");
    await saveRequest(req);
    await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: action === "reject" ? "REJECT" : "UPDATE", module: "approvals", documentType: label, documentId: req.recordId, newValue: { requestNo: req.requestNo, stage: st.stage, sentBack: action === "send-back", ownerOverride: st.override }, reason: note });
    await notifyRequester(req, action === "reject" ? "was rejected" : "was sent back for correction", st.decidedByName, note);
    return { approvalMessage: action === "reject" ? `${req.requestNo} rejected. Nothing was changed.` : `${req.requestNo} sent back to ${req.requestedByName || "the requester"} for correction.` };
  }

  const stageNo = req.currentStage;
  const st = await markStage(ctx, req, "APPROVED", note);
  const more = await activateFrom(req, req.stages.indexOf(st) + 1);
  if (more) {
    await saveRequest(req);
    await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "APPROVE", module: "approvals", documentType: label, documentId: req.recordId, newValue: { requestNo: req.requestNo, stage: st.stage, final: false, ownerOverride: st.override }, reason: note || undefined });
    await notifyApprovers(req);
    return { approvalMessage: `Stage-${st.stage} approved. Now waiting for ${await currentApproverLabel(ctx.businessId, req)}.` };
  }

  // Last stage: claim the run, so a second approver acting at the same moment can't run it too.
  const claimed = await ApprovalRequest.updateOne(
    { _id: req._id, businessId: ctx.businessId, status: "PENDING", currentStage: stageNo, __v: req.__v, $or: [{ executingAt: null }, { executingAt: { $lt: new Date(Date.now() - 10 * 60 * 1000) } }] },
    { $set: { executingAt: new Date() }, $inc: { __v: 1 } }
  );
  if (!claimed.modifiedCount) throw AppError.conflict("Someone else decided this approval a moment ago. Refresh to see where it stands.", "APPROVAL_CONFLICT");

  let summary: string | void = "";
  try {
    summary = await run(ctx, req.payload, req);
  } catch (err) {
    const code = err instanceof AppError ? err.code : "";
    if (STALE_CODES.has(code)) {
      const reason = `Could not be applied when approved: ${(err as Error).message}`;
      await ApprovalRequest.updateOne({ _id: req._id }, { $set: { executingAt: null, status: "CANCELLED", closedReason: reason, decidedAt: new Date(), currentApproverUserIds: [], currentGroupId: null, currentRoleId: null }, $inc: { __v: 1 } });
      await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "approvals", documentType: label, documentId: req.recordId, reason });
      await notifyRequester(req, "could not be applied", await myName(ctx), (err as Error).message);
    } else {
      await ApprovalRequest.updateOne({ _id: req._id }, { $set: { executingAt: null } });
    }
    throw err;
  }

  // Applied: record the decision on the fresh copy.
  const fresh = await ApprovalRequest.findById(req._id);
  const fst = fresh.stages.find((s: AnyDoc) => s.stage === stageNo);
  Object.assign(fst, { status: "APPROVED", decidedByUserId: st.decidedByUserId, decidedByName: st.decidedByName, decidedAt: st.decidedAt, note: st.note, override: st.override });
  for (const s of fresh.stages) if (s.stage > stageNo && s.status === "WAITING") s.status = "SKIPPED";
  if (note) fresh.comments.push({ userId: ctx.userId, name: st.decidedByName, text: note, stage: stageNo, kind: "APPROVE", at: new Date() });
  closeRequest(fresh, "APPROVED");
  fresh.executingAt = null;
  fresh.resultSummary = summary || "";
  await fresh.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "APPROVE", module: "approvals", documentType: label, documentId: fresh.recordId, newValue: { requestNo: fresh.requestNo, stage: stageNo, final: true, applied: summary || true, ownerOverride: st.override }, reason: note || undefined });
  await notifyRequester(fresh, "was approved and applied", st.decidedByName, note);
  return { approvalMessage: `${fresh.requestNo} approved and applied${summary ? `: ${summary}` : "."}`, applied: true };
}

/** The requester sends a sent-back action again (as it was, with an optional note). A new round starts from stage 1. */
export async function resubmitHeldAction(ctx: AuthContext, id: string, note: string, run: ActionRunner, requiredPermission?: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const old = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId });
  if (!old || !inProducts(ctx, old.document)) throw AppError.notFound("Approval not found");
  if (old.kind !== "action") throw AppError.badRequest("Send this again from its own screen.", "RESUBMIT_FROM_MODULE");
  if (String(old.requestedByUserId) !== String(ctx.userId) && !isOwner(ctx)) throw AppError.forbidden("Only the person who raised it can send it again.", "NOT_REQUESTER");
  if (old.status !== "SENT_BACK") throw AppError.conflict("Only a request that was sent back can be sent again.", "NOT_SENT_BACK");
  if (old.closedReason) throw AppError.conflict(`It was already ${old.closedReason.toLowerCase()}.`, "ALREADY_REPLACED");
  if (requiredPermission && !isOwner(ctx) && !ctx.permissions.includes(requiredPermission)) throw AppError.forbidden(`Missing required permission: ${requiredPermission}`);

  const scheme = await activeScheme(ctx.businessId, old.document);
  if (!scheme) {
    // No approval needed any more: apply it now, as the requester.
    const summary = await run(ctx, old.payload, old);
    old.closedReason = "Applied without approval: the scheme was switched off";
    await old.save();
    return { applied: true, approvalMessage: `Applied${summary ? `: ${summary}` : ""}. Its approval scheme is switched off now.` };
  }
  const open = await ApprovalRequest.exists({ businessId: ctx.businessId, targetKey: old.targetKey, status: "PENDING", kind: "action" });
  if (open) throw AppError.conflict("Another change to the same thing is waiting for approval.", "APPROVAL_ALREADY_PENDING");

  const req = await newRequest(ctx, scheme, old.document, {
    id: old.recordId,
    number: old.recordNumber,
    summary: old.summary,
    amount: old.amount != null ? String(old.amount) : null,
    employeeId: old.employeeId,
    requestedByUserId: old.requestedByUserId,
    details: old.details,
    fingerprint: old.fingerprint,
    kind: "action",
    targetKey: old.targetKey,
    payload: old.payload,
  });
  // The conversation so far travels with it.
  req.comments = [...old.comments, ...(note ? [{ userId: ctx.userId, name: await myName(ctx), text: note, stage: 0, kind: "RESUBMIT", at: new Date() }] : [])];
  if (!(await activateFrom(req, 0))) {
    const summary = await run(ctx, old.payload, old);
    old.closedReason = "Applied: no stage applied to it any more";
    await old.save();
    return { applied: true, approvalMessage: `Applied${summary ? `: ${summary}` : ""}.` };
  }
  await saveRequest(req);
  old.closedReason = `Sent again as ${req.requestNo}`;
  await saveRequest(old);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "approvals", documentType: docLabel(old.document), documentId: old.recordId, newValue: { requestNo: req.requestNo, resubmittedFrom: old.requestNo }, reason: note || undefined });
  await notifyApprovers(req);
  return { id: String(req._id), requestNo: req.requestNo, approvalMessage: `Sent again as ${req.requestNo}. Waiting for ${await currentApproverLabel(ctx.businessId, req)}.` };
}

/** The requester withdraws a held action that is waiting or was sent back. Nothing is applied. */
export async function withdrawHeldAction(ctx: AuthContext, id: string, note: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId });
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (req.kind !== "action") throw AppError.badRequest("Withdraw this from its own screen (e.g. withdraw the leave or claim).", "WITHDRAW_FROM_MODULE");
  if (String(req.requestedByUserId) !== String(ctx.userId) && !isOwner(ctx)) throw AppError.forbidden("Only the person who raised it can withdraw it.", "NOT_REQUESTER");
  if (req.status !== "PENDING" && !(req.status === "SENT_BACK" && !req.closedReason)) throw AppError.conflict(`This approval is already ${String(req.status).toLowerCase().replace("_", " ")}.`, "APPROVAL_CLOSED");
  if (req.executingAt) throw AppError.conflict("This change is being applied right now.", "APPROVAL_CONFLICT");
  if (note) req.comments.push({ userId: ctx.userId, name: await myName(ctx), text: note, stage: req.currentStage, kind: "WITHDRAW", at: new Date() });
  closeRequest(req, "CANCELLED");
  req.closedReason = "Withdrawn by the requester";
  await saveRequest(req);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "approvals", documentType: docLabel(req.document), documentId: req.recordId, newValue: { requestNo: req.requestNo }, reason: note || "Withdrawn" });
  return { id, approvalMessage: `${req.requestNo} withdrawn. Nothing was changed.` };
}

export const commentSchema = z.object({ text: z.string().trim().min(1, "Write a comment").max(1000) });

/** Anyone who can see the request may comment; the requester and its approvers are told. */
export async function addComment(ctx: AuthContext, id: string, text: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId });
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (!(await maySee(ctx, req))) throw AppError.forbidden("You are not part of this approval", "APPROVAL_PRIVATE");
  const name = await myName(ctx);
  // $push, not save(): a comment must never collide with a decision.
  await ApprovalRequest.updateOne({ _id: req._id }, { $push: { comments: { userId: ctx.userId, name, text, stage: req.status === "PENDING" ? req.currentStage : 0, kind: "COMMENT", at: new Date() } } });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "approvals", documentType: docLabel(req.document), documentId: req.recordId, newValue: { requestNo: req.requestNo, comment: text } });
  const involved = [req.requestedByUserId, ...(req.stages ?? []).map((s: AnyDoc) => s.decidedByUserId), ...(req.status === "PENDING" ? await currentApproverUserIds(req) : [])].filter((u) => u && String(u) !== String(ctx.userId));
  await notify(ctx.businessId, involved, { kind: "APPROVAL_COMMENT", title: `${name || "Someone"} commented on ${docLabel(req.document)} ${req.requestNo || req.recordNumber}`, body: text.slice(0, 200), requestId: req._id });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Approval management lists                                           */
/* ------------------------------------------------------------------ */

export const QUEUE_SCOPES = ["mine", "approved", "rejected", "history", "raised", "all"] as const;
export type QueueScope = (typeof QUEUE_SCOPES)[number];

export const queueSchema = z.object({
  scope: z.enum(QUEUE_SCOPES).default("mine"),
  /** A display status, the stored PENDING (= both pending kinds), or blank for any. */
  status: z.enum([...APPROVAL_DISPLAY_STATUSES, "PENDING", ""]).optional().default(""),
  document: z.string().trim().max(60).optional(),
  group: z.string().trim().max(60).optional(),
  query: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

function escapeRegex(v: string) {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function myGroupIds(ctx: AuthContext) {
  const g = await ApprovalUserGroup.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", userIds: ctx.userId }, { _id: 1 }).lean<AnyDoc[]>();
  return g.map((x) => x._id);
}

/** Requests waiting for this user: named, through a group, or through their role. */
async function waitingForMeFilter(ctx: AuthContext) {
  return {
    status: "PENDING",
    requestedByUserId: { $ne: ctx.userId },
    $or: [{ currentApproverUserIds: ctx.userId }, { currentGroupId: { $in: await myGroupIds(ctx) } }, ...(ctx.roleId ? [{ currentRoleId: ctx.roleId }] : [])],
  };
}

function statusFilter(status: string): Record<string, unknown> {
  switch (status) {
    case "":
      return {};
    case "PENDING_APPROVAL":
      return { status: "PENDING", stages: { $not: { $elemMatch: { status: "APPROVED" } } } };
    case "PARTIALLY_APPROVED":
      return { status: "PENDING", "stages.status": "APPROVED" };
    default:
      return { status };
  }
}

async function rowOut(ctx: AuthContext, r: AnyDoc) {
  const def = approvalDocument(r.document);
  const pending = r.status === "PENDING";
  const canAct = pending && (await mayAct(ctx, r));
  const own = String(r.requestedByUserId) === String(ctx.userId);
  return {
    id: String(r._id),
    requestNo: r.requestNo || "",
    document: r.document,
    documentLabel: docLabel(r.document),
    group: def?.group ?? "",
    module: def?.module ?? "",
    kind: r.kind ?? "record",
    recordId: String(r.recordId),
    href: approvalHref(r.document, String(r.recordId)),
    recordNumber: r.recordNumber,
    summary: r.summary,
    amount: r.amount != null ? d(r.amount).toFixed(2) : null,
    requestedByName: r.requestedByName,
    departmentName: r.departmentName ?? "",
    requestedAt: r.createdAt,
    decidedAt: r.decidedAt ?? null,
    status: r.status,
    displayStatus: displayStatus(r),
    currentStage: pending ? r.currentStage : 0,
    stageCount: (r.stages ?? []).length,
    waitingFor: pending ? await currentApproverLabel(ctx.businessId, r) : "",
    canAct,
    canSendBack: canAct && Boolean(def?.sendBack),
    canWithdraw: (own || isOwner(ctx)) && r.kind === "action" && (pending || (r.status === "SENT_BACK" && !r.closedReason)),
    canResubmit: (own || isOwner(ctx)) && r.kind === "action" && r.status === "SENT_BACK" && !r.closedReason,
    closedReason: r.closedReason ?? "",
    resultSummary: r.resultSummary ?? "",
    comments: (r.comments ?? []).length,
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
  };
}

export async function approvalQueue(ctx: AuthContext, params: z.infer<typeof queueSchema>, canSeeAll: boolean) {
  const allowed = allowedDocs(ctx);
  let docs = allowed;
  if (params.group) docs = docs.filter((k) => approvalDocument(k)?.group === params.group);
  if (params.document) docs = docs.filter((k) => k === params.document);
  const filter: Record<string, unknown> = { businessId: ctx.businessId, document: { $in: docs } };
  const and: Record<string, unknown>[] = [];

  switch (params.scope) {
    case "all":
      if (!canSeeAll) throw AppError.forbidden("Missing required permission: approvals.view");
      break;
    case "raised":
      filter.requestedByUserId = ctx.userId;
      break;
    case "approved":
      filter.stages = { $elemMatch: { decidedByUserId: ctx.userId, status: "APPROVED" } };
      break;
    case "rejected":
      filter.stages = { $elemMatch: { decidedByUserId: ctx.userId, status: { $in: ["REJECTED", "SENT_BACK"] } } };
      break;
    case "history":
      filter["stages.decidedByUserId"] = ctx.userId;
      break;
    default:
      and.push(await waitingForMeFilter(ctx));
  }
  if (params.scope !== "mine") {
    const { stages: stageCond, ...rest } = statusFilter(params.status ?? "");
    Object.assign(filter, rest);
    // Both the scope and the status may constrain `stages`: keep both conditions.
    if (stageCond) and.push({ stages: stageCond });
    else if ("stages.status" in rest) {
      delete filter["stages.status"];
      and.push({ "stages.status": rest["stages.status"] });
    }
  }
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    and.push({ $or: [{ requestNo: rx }, { recordNumber: rx }, { requestedByName: rx }, { summary: rx }, { departmentName: rx }] });
  }
  if (and.length) filter.$and = and;

  const [rows, total] = await Promise.all([
    ApprovalRequest.find(filter, { payload: 0 }).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    ApprovalRequest.countDocuments(filter),
  ]);
  const items = [];
  for (const r of rows) items.push(await rowOut(ctx, r));
  return { items, total, page: params.page, pageSize: params.pageSize };
}

/** Badge counts for the approval screens: waiting for me, and my requests that were sent back to me. */
export async function approvalCounts(ctx: AuthContext) {
  const docs = allowedDocs(ctx);
  const [mine, sentBack, raisedOpen] = await Promise.all([
    ApprovalRequest.countDocuments({ businessId: ctx.businessId, document: { $in: docs }, ...(await waitingForMeFilter(ctx)) }),
    ApprovalRequest.countDocuments({ businessId: ctx.businessId, document: { $in: docs }, requestedByUserId: ctx.userId, status: "SENT_BACK", closedReason: "" }),
    ApprovalRequest.countDocuments({ businessId: ctx.businessId, document: { $in: docs }, requestedByUserId: ctx.userId, status: "PENDING" }),
  ]);
  return { mine, sentBack, raisedOpen };
}

/** Everything about one request for the detail panel: what it is, its stages, comments and earlier rounds. */
export async function requestDetail(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (!(await maySee(ctx, req))) throw AppError.forbidden("You are not part of this approval", "APPROVAL_PRIVATE");
  const n = await stageNames(ctx.businessId, req.stages ?? []);
  const history = await requestHistory(ctx, id);
  const def = approvalDocument(req.document);
  return {
    ...(await rowOut(ctx, req)),
    trigger: def?.trigger ?? "",
    details: (req.details ?? []).map((x: AnyDoc) => ({ label: x.label, value: x.value })),
    stagesDetail: (req.stages ?? []).map((s: AnyDoc) => stageOut(s, n)),
    commentsList: (req.comments ?? []).map((c: AnyDoc) => ({ name: c.name, text: c.text, stage: c.stage, kind: c.kind, at: c.at })),
    rounds: history.rounds,
  };
}

/** The request an approver is acting on from the approval screens, after checking they may. */
export async function requestForAction(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const req = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId });
  // A product the workspace no longer has can't be acted on.
  if (!req || !inProducts(ctx, req.document)) throw AppError.notFound("Approval not found");
  if (req.status !== "PENDING") throw AppError.conflict(`This approval is already ${String(req.status).toLowerCase().replace("_", " ")}`, "APPROVAL_CLOSED");
  if (!(await mayAct(ctx, req))) throw AppError.forbidden(`Waiting for ${await currentApproverLabel(ctx.businessId, req)}.`, "APPROVAL_NOT_YOURS");
  return req;
}

/** How many approvals are waiting for this user (sidebar badge, dashboard). */
export async function pendingForMeCount(ctx: AuthContext) {
  return ApprovalRequest.countDocuments({ businessId: ctx.businessId, document: { $in: allowedDocs(ctx) }, ...(await waitingForMeFilter(ctx)) });
}

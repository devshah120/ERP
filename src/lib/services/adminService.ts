import { Types } from "mongoose";
import { z } from "zod";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { AuditLog, AUDIT_ACTIONS } from "@/models/AuditLog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/**
 * Read-only administration views: who has access, with which role, and what
 * has been done in the workspace. Every query is scoped by businessId; none of
 * these functions writes anything.
 */

export async function listUsers(businessId: Types.ObjectId) {
  const [users, roles] = await Promise.all([
    User.find({ businessId }).sort({ createdAt: 1 }).lean<AnyDoc[]>(),
    Role.find({ businessId }, { name: 1 }).lean<AnyDoc[]>(),
  ]);
  const roleName = new Map(roles.map((r) => [r._id.toString(), r.name as string]));
  return {
    items: users.map((u) => ({
      id: u._id.toString(),
      name: u.name,
      username: u.username,
      email: u.email,
      phone: u.phone ?? null,
      status: u.status,
      roleId: u.roleId?.toString() ?? null,
      role: roleName.get(u.roleId?.toString()) ?? null,
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt: u.createdAt,
    })),
  };
}

export async function listRoles(businessId: Types.ObjectId) {
  const [roles, counts] = await Promise.all([
    Role.find({ businessId }).sort({ isSystemRole: -1, name: 1 }).lean<AnyDoc[]>(),
    User.aggregate([{ $match: { businessId } }, { $group: { _id: "$roleId", n: { $sum: 1 } } }]),
  ]);
  const members = new Map((counts as AnyDoc[]).map((c) => [c._id?.toString(), c.n as number]));
  return {
    items: roles.map((r) => ({
      id: r._id.toString(),
      name: r.name,
      description: r.description ?? null,
      permissions: r.permissions as string[],
      fullAccess: (r.permissions as string[]).includes("*"),
      isSystemRole: Boolean(r.isSystemRole),
      isActive: r.isActive !== false,
      members: members.get(r._id.toString()) ?? 0,
    })),
  };
}

export const auditQuerySchema = z.object({
  module: z.string().trim().max(60).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  userId: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export async function listAuditLogs(businessId: Types.ObjectId, q: AuditQuery) {
  const filter: Record<string, unknown> = { businessId };
  if (q.module) filter.module = q.module;
  if (q.action) filter.action = q.action;
  if (q.userId && Types.ObjectId.isValid(q.userId)) filter.userId = new Types.ObjectId(q.userId);
  if (q.fromDate || q.toDate) {
    const range: Record<string, Date> = {};
    if (q.fromDate) range.$gte = new Date(`${q.fromDate}T00:00:00`);
    if (q.toDate) range.$lte = new Date(`${q.toDate}T23:59:59.999`);
    filter.createdAt = range;
  }

  const [rows, total, modules] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      // Before/after values can be large; the list shows what changed, not the payload.
      .select({ oldValue: 0, newValue: 0 })
      .lean<AnyDoc[]>(),
    AuditLog.countDocuments(filter),
    AuditLog.distinct("module", { businessId }),
  ]);

  const userIds = [...new Set(rows.map((r) => r.userId?.toString()).filter(Boolean))];
  const users = await User.find({ businessId, _id: { $in: userIds } }, { name: 1 }).lean<AnyDoc[]>();
  const nameOf = new Map(users.map((u) => [u._id.toString(), u.name as string]));

  return {
    items: rows.map((r) => ({
      id: r._id.toString(),
      at: r.createdAt,
      action: r.action,
      module: r.module,
      documentType: r.documentType ?? null,
      documentId: r.documentId?.toString() ?? null,
      reason: r.reason ?? null,
      ip: r.ip ?? null,
      user: r.userId ? nameOf.get(r.userId.toString()) ?? "Former user" : "System",
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
    modules: (modules as string[]).sort(),
  };
}

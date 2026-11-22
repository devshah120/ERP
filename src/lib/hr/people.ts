import { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Employee, HrAsset, Shift, LeaveApplication, EmployeeLoan, Announcement, Holiday, WORKING_STATUSES } from "@/models/hr";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { Session } from "@/models/Session";
import { Business } from "@/models/Business";
import { hashPassword, isPasswordStrongEnough } from "@/lib/auth/password";
import { uniqueUsername } from "@/lib/auth/username";
import { recordAudit } from "@/lib/services/auditService";
import { serializeDoc } from "@/lib/resources/serialize";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, todayIn } from "./calendar";
import { balancesFor } from "./leave";
import { employeePayslips } from "./payroll";
import { selfServiceRole } from "./setup";
import { findEmployee, employeeLabels, selfEmployee, businessTimeZone, escapeRegex, pageQuery, type AnyDoc } from "./common";

const d = (v: unknown) => new Decimal(v ? String(v) : "0");

/* ------------------------------------------------------------------ */
/* Directory & profile                                                 */
/* ------------------------------------------------------------------ */

export const directorySchema = z.object({
  query: z.string().trim().max(100).optional(),
  departmentId: z.string().trim().optional(),
  employmentStatus: z.string().trim().max(20).optional(),
  scope: z.enum(["current", "former", "all"]).default("current"),
  ...pageQuery,
});

export async function directory(ctx: AuthContext, params: z.infer<typeof directorySchema>) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null };
  if (params.scope === "current") filter.employmentStatus = { $in: WORKING_STATUSES };
  if (params.scope === "former") filter.employmentStatus = { $nin: WORKING_STATUSES };
  if (params.employmentStatus) filter.employmentStatus = params.employmentStatus;
  if (params.departmentId && Types.ObjectId.isValid(params.departmentId)) filter.departmentId = new Types.ObjectId(params.departmentId);
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    filter.$or = [{ name: rx }, { employeeCode: rx }, { workEmail: rx }, { phone: rx }];
  }
  const [rows, total] = await Promise.all([
    Employee.find(filter).sort({ employeeCode: 1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    Employee.countDocuments(filter),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r._id));
  const managers = await employeeLabels(ctx.businessId, rows.map((r) => r.reportingManagerId).filter(Boolean));
  return {
    items: rows.map((e) => ({
      id: String(e._id),
      employeeCode: e.employeeCode,
      name: e.name,
      department: labels.get(String(e._id))?.department ?? "",
      designation: labels.get(String(e._id))?.designation ?? "",
      manager: e.reportingManagerId ? managers.get(String(e.reportingManagerId))?.name ?? "" : "",
      phone: e.phone ?? "",
      workEmail: e.workEmail ?? "",
      dateOfJoining: e.dateOfJoining,
      employmentType: e.employmentType,
      employmentStatus: e.employmentStatus,
      hasPortal: Boolean(e.userId),
    })),
    total,
  };
}

function monthlyGross(e: AnyDoc) {
  return d(e.basic).plus(d(e.hra)).plus(d(e.conveyance)).plus(d(e.specialAllowance)).plus(d(e.otherAllowance));
}

/** Everything HR wants on one screen about a person. */
export async function employeeProfile(ctx: AuthContext, id: string) {
  const emp = await findEmployee(ctx.businessId, id);
  const year = new Date().getUTCFullYear();
  const [labels, manager, shift, balances, leaves, loans, assets, payslips, reports, portalUser] = await Promise.all([
    employeeLabels(ctx.businessId, [emp._id]),
    emp.reportingManagerId ? employeeLabels(ctx.businessId, [emp.reportingManagerId]) : Promise.resolve(new Map()),
    emp.shiftId ? Shift.findOne({ _id: emp.shiftId, businessId: ctx.businessId }, { name: 1, startTime: 1, endTime: 1 }).lean<AnyDoc>() : Promise.resolve(null),
    balancesFor(ctx.businessId, [emp._id], year),
    LeaveApplication.find({ businessId: ctx.businessId, employeeId: emp._id }).sort({ fromDate: -1 }).limit(10).lean<AnyDoc[]>(),
    EmployeeLoan.find({ businessId: ctx.businessId, employeeId: emp._id, status: "ACTIVE" }).lean<AnyDoc[]>(),
    HrAsset.find({ businessId: ctx.businessId, employeeId: emp._id, deletedAt: null, returnedDate: null }).lean<AnyDoc[]>(),
    employeePayslips(ctx, emp._id),
    Employee.find({ businessId: ctx.businessId, reportingManagerId: emp._id, deletedAt: null, employmentStatus: { $in: WORKING_STATUSES } }, { name: 1, employeeCode: 1 }).lean<AnyDoc[]>(),
    emp.userId ? User.findOne({ _id: emp.userId, businessId: ctx.businessId }, { email: 1, status: 1, lastLoginAt: 1 }).lean<AnyDoc>() : Promise.resolve(null),
  ]);
  const label = labels.get(String(emp._id));
  const plain = serializeDoc(emp) as Record<string, unknown>;
  return {
    ...plain,
    department: label?.department ?? "",
    designation: label?.designation ?? "",
    manager: emp.reportingManagerId ? { id: String(emp.reportingManagerId), name: manager.get(String(emp.reportingManagerId))?.name ?? "" } : null,
    shift: shift ? { name: shift.name, startTime: shift.startTime, endTime: shift.endTime } : null,
    monthlyGross: monthlyGross(emp).toFixed(2),
    annualCtc: monthlyGross(emp).times(12).toFixed(2),
    leaveBalances: balances.get(String(emp._id)) ?? [],
    recentLeaves: leaves.map((l) => ({ id: String(l._id), leaveNumber: l.leaveNumber, fromDate: dayKey(toDay(l.fromDate)), toDate: dayKey(toDay(l.toDate)), days: l.days, status: l.status })),
    activeLoans: loans.map((l) => ({ id: String(l._id), loanNumber: l.loanNumber, outstanding: d(l.amount).minus(d(l.repaidAmount)).toFixed(2), emiAmount: d(l.emiAmount).toFixed(2) })),
    assets: assets.map((a) => ({ id: String(a._id), assetTag: a.assetTag, name: a.name, assignedDate: a.assignedDate })),
    payslips,
    directReports: reports.map((r) => ({ id: String(r._id), name: r.name, employeeCode: r.employeeCode })),
    portal: portalUser ? { email: portalUser.email, status: portalUser.status, lastLoginAt: portalUser.lastLoginAt } : null,
  };
}

/* ------------------------------------------------------------------ */
/* Portal access                                                       */
/* ------------------------------------------------------------------ */

export const portalAccessSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter the email they will sign in with"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .refine(isPasswordStrongEnough, "Include an uppercase letter, lowercase letter, digit and symbol")
    .optional(),
});

/**
 * Gives an employee a self-service login. A new login gets the fixed
 * "Employee (Self Service)" role and must change the handed-over password;
 * if the email already belongs to a colleague's login (say, the HR manager
 * is also on payroll) that login is linked instead, keeping its role.
 */
export async function grantPortalAccess(ctx: AuthContext, employeeId: string, input: z.infer<typeof portalAccessSchema>) {
  const emp = await findEmployee(ctx.businessId, employeeId);
  if (emp.userId) throw AppError.conflict("This employee already has portal access", "PORTAL_EXISTS");

  let user = await User.findOne({ businessId: ctx.businessId, email: input.email });
  let created = false;
  if (user) {
    const linked = await Employee.findOne({ businessId: ctx.businessId, userId: user._id, deletedAt: null }, { name: 1 }).lean<AnyDoc>();
    if (linked) throw AppError.conflict(`That login is already linked to ${linked.name}`, "LOGIN_ALREADY_LINKED");
  } else {
    if (!input.password) throw AppError.badRequest("Set a temporary password for the new login", "PASSWORD_REQUIRED");
    const role = await selfServiceRole(ctx.businessId);
    user = await User.create({
      businessId: ctx.businessId,
      name: emp.name,
      username: await uniqueUsername(ctx.businessId, input.email),
      email: input.email,
      phone: emp.phone ?? "",
      passwordHash: await hashPassword(input.password),
      roleId: role._id,
      status: "ACTIVE",
      isEmailVerified: false,
      mustChangePassword: true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
    created = true;
  }

  await Employee.updateOne({ _id: emp._id, businessId: ctx.businessId }, { userId: user._id, updatedBy: ctx.userId, ...(emp.workEmail ? {} : { workEmail: input.email }) });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.employees", documentType: "Employee", documentId: emp._id, newValue: { portalEmail: input.email, newLogin: created } });
  return { email: input.email, created };
}

/** Removes portal access: a self-service-only login is disabled and signed out everywhere; a staff login is just unlinked. */
export async function revokePortalAccess(ctx: AuthContext, employeeId: string) {
  const emp = await findEmployee(ctx.businessId, employeeId);
  if (!emp.userId) throw AppError.badRequest("This employee has no portal access", "NO_PORTAL");
  const user = await User.findOne({ _id: emp.userId, businessId: ctx.businessId });
  if (user) {
    const role = await Role.findOne({ _id: user.roleId, businessId: ctx.businessId }, { permissions: 1 }).lean<AnyDoc>();
    const selfOnly = role && (role.permissions as string[]).every((p) => p.startsWith("hr-self."));
    if (selfOnly) {
      user.status = "DISABLED";
      user.updatedBy = ctx.userId;
      await user.save();
      await Session.updateMany({ businessId: ctx.businessId, userId: user._id, revokedAt: null }, { revokedAt: new Date() });
    }
  }
  await Employee.updateOne({ _id: emp._id, businessId: ctx.businessId }, { userId: null, updatedBy: ctx.userId });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.employees", documentType: "Employee", documentId: emp._id, reason: "Portal access removed" });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Self-service overview                                               */
/* ------------------------------------------------------------------ */

export async function myProfile(ctx: AuthContext) {
  const emp = await selfEmployee(ctx);
  const tz = await businessTimeZone(ctx.businessId);
  const today = todayIn(tz);
  const year = today.getUTCFullYear();
  const [labels, manager, balances, announcements, holidays, business] = await Promise.all([
    employeeLabels(ctx.businessId, [emp._id]),
    emp.reportingManagerId ? employeeLabels(ctx.businessId, [emp.reportingManagerId]) : Promise.resolve(new Map()),
    balancesFor(ctx.businessId, [emp._id], year),
    activeAnnouncements(ctx.businessId, today),
    Holiday.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", date: { $gte: today } }).sort({ date: 1 }).limit(6).lean<AnyDoc[]>(),
    Business.findById(ctx.businessId, { tradeName: 1 }).lean<AnyDoc>(),
  ]);
  const label = labels.get(String(emp._id));
  return {
    employee: {
      id: String(emp._id),
      employeeCode: emp.employeeCode,
      name: emp.name,
      department: label?.department ?? "",
      designation: label?.designation ?? "",
      manager: emp.reportingManagerId ? manager.get(String(emp.reportingManagerId))?.name ?? "" : "",
      dateOfJoining: emp.dateOfJoining,
      workEmail: emp.workEmail ?? "",
      phone: emp.phone ?? "",
      bankAccountNumber: emp.bankAccountNumber ? `••••${String(emp.bankAccountNumber).slice(-4)}` : "",
      panNumber: emp.panNumber ?? "",
      uanNumber: emp.uanNumber ?? "",
    },
    company: business?.tradeName ?? "",
    leaveBalances: balances.get(String(emp._id)) ?? [],
    announcements,
    holidays: holidays.map((h) => ({ id: String(h._id), name: h.name, date: dayKey(toDay(h.date)), holidayType: h.holidayType })),
  };
}

export async function activeAnnouncements(businessId: Types.ObjectId, today: Date) {
  const rows = await Announcement.find({
    businessId,
    deletedAt: null,
    status: "ACTIVE",
    publishDate: { $lte: today },
    $or: [{ expiryDate: null }, { expiryDate: { $gte: today } }],
  })
    .sort({ pinned: -1, publishDate: -1 })
    .limit(8)
    .lean<AnyDoc[]>();
  return rows.map((a) => ({ id: String(a._id), title: a.title, message: a.message, publishDate: dayKey(toDay(a.publishDate)), pinned: a.pinned }));
}

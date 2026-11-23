import type { ClientSession, Types } from "mongoose";
import { Role } from "@/models/Role";
import { HrDepartment, Designation, HrGrade, Shift, LeaveType, PayComponent, AttendanceReason } from "@/models/hr";
import { SYSTEM_ATTENDANCE_REASONS } from "./regularization";
import { DEFAULT_PAY_COMPONENTS } from "./variables";
import { HR_PERMISSION_KEYS, HR_SELF_SERVICE_PERMISSIONS } from "@/lib/auth/permissionCatalog";

export const HR_MANAGER_ROLE = "HR Manager";
export const SELF_SERVICE_ROLE = "Employee (Self Service)";

const DEPARTMENTS = [
  { code: "ADMIN", name: "Administration" },
  { code: "HR", name: "Human Resources" },
  { code: "FIN", name: "Finance & Accounts" },
  { code: "SALES", name: "Sales & Marketing" },
  { code: "OPS", name: "Operations" },
];

const DESIGNATIONS = [
  { code: "DIR", name: "Director" },
  { code: "MGR", name: "Manager" },
  { code: "TL", name: "Team Lead" },
  { code: "EXEC", name: "Executive" },
  { code: "ASSOC", name: "Associate" },
  { code: "INTERN", name: "Intern" },
];

const GRADES = [
  { code: "L1", name: "Leadership" },
  { code: "L2", name: "Senior management" },
  { code: "L3", name: "Middle management" },
  { code: "L4", name: "Executive" },
  { code: "L5", name: "Associate" },
  { code: "L6", name: "Trainee" },
];

const LEAVE_TYPES = [
  { code: "CL", name: "Casual Leave", annualQuota: 12, isPaid: true, allowHalfDay: true },
  { code: "SL", name: "Sick Leave", annualQuota: 7, isPaid: true, allowHalfDay: true },
  { code: "EL", name: "Earned Leave", annualQuota: 15, isPaid: true, allowHalfDay: false, carryForward: true, maxCarryForward: 30, encashable: true },
  { code: "LOP", name: "Loss of Pay", annualQuota: 0, isPaid: false, allowHalfDay: true, allowNegative: true, description: "Unpaid leave; deducted from salary." },
];

/**
 * Starter HR setup for a workspace that has just been given HRMS: a general
 * shift, the common Indian leave types, a few departments, designations and grades,
 * and the HR Manager / self-service roles. Idempotent — each kind of master
 * is only seeded when the workspace has none yet, and roles are matched by
 * name, so enabling HRMS again never duplicates anything.
 */
export async function seedHrDefaults(businessId: Types.ObjectId, session?: ClientSession): Promise<void> {
  const opts = session ? { session } : {};
  const live = { businessId, deletedAt: null };

  if ((await Shift.countDocuments(live, opts)) === 0) {
    await Shift.create(
      [{ businessId, name: "General Shift", startTime: "09:30", endTime: "18:30", graceMinutes: 15, halfDayHours: 4, fullDayHours: 8, weeklyOff1: "SUNDAY", weeklyOff2: "", isDefault: true }],
      opts
    );
  }
  if ((await LeaveType.countDocuments(live, opts)) === 0) {
    await LeaveType.create(LEAVE_TYPES.map((l) => ({ businessId, ...l })), { ...opts, ordered: true });
  }
  if ((await PayComponent.countDocuments(live, opts)) === 0) {
    await PayComponent.create(DEFAULT_PAY_COMPONENTS.map((c) => ({ businessId, ...c })), { ...opts, ordered: true });
  }
  if ((await HrDepartment.countDocuments(live, opts)) === 0) {
    await HrDepartment.create(DEPARTMENTS.map((d) => ({ businessId, ...d })), { ...opts, ordered: true });
  }
  if ((await Designation.countDocuments(live, opts)) === 0) {
    await Designation.create(DESIGNATIONS.map((d) => ({ businessId, ...d })), { ...opts, ordered: true });
  }
  if ((await HrGrade.countDocuments(live, opts)) === 0) {
    await HrGrade.create(GRADES.map((g) => ({ businessId, ...g })), { ...opts, ordered: true });
  }
  if ((await AttendanceReason.countDocuments({ businessId }, opts)) === 0) {
    await AttendanceReason.create(SYSTEM_ATTENDANCE_REASONS.map((name) => ({ businessId, name, reasonType: "SYSTEM" })), { ...opts, ordered: true });
  }

  await ensureRole(businessId, HR_MANAGER_ROLE, "Runs HR: employees, attendance, leave approvals, payroll and reports.", [...HR_PERMISSION_KEYS, "users.view"], false, session);
  await ensureRole(businessId, SELF_SERVICE_ROLE, "Employee portal: own attendance, leave, payslips and claims.", HR_SELF_SERVICE_PERMISSIONS, true, session);
}

/**
 * Brings HR Manager roles created before a permission existed up to date:
 * HR could always decide anyone's leave, which is now its own permission.
 * Cheap and idempotent; tokens pick it up at their next refresh.
 */
export async function upgradeHrRoles(businessId: Types.ObjectId): Promise<void> {
  await Role.updateOne(
    { businessId, name: HR_MANAGER_ROLE, permissions: { $all: ["hr-leaves.approve"], $nin: ["hr-leaves.approve-all"] } },
    { $addToSet: { permissions: "hr-leaves.approve-all" } }
  );
}

/** HR Manager stays editable (a normal custom role); the self-service role is fixed because portal access relies on it. */
async function ensureRole(businessId: Types.ObjectId, name: string, description: string, permissions: string[], isSystemRole: boolean, session?: ClientSession) {
  const opts = session ? { session } : {};
  const existing = await Role.findOne({ businessId, name }, null, opts);
  if (existing) return existing;
  const [role] = await Role.create([{ businessId, name, description, permissions, isSystemRole, isActive: true }], opts);
  return role;
}

/** The self-service role, created on demand for workspaces seeded before it existed. */
export async function selfServiceRole(businessId: Types.ObjectId) {
  return ensureRole(businessId, SELF_SERVICE_ROLE, "Employee portal: own attendance, leave, payslips and claims.", HR_SELF_SERVICE_PERMISSIONS, true);
}

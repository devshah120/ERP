import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { Employee } from "@/models/hr";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { hashPassword, isPasswordStrongEnough } from "@/lib/auth/password";
import { uniqueUsername } from "@/lib/auth/username";
import { hasPermission, type AuthContext } from "@/lib/auth/context";
import { recordAudit } from "@/lib/services/auditService";
import { selfServiceRole } from "./setup";
import type { AnyDoc } from "./common";

/*
 * A sign-in for an employee: created with a chosen role (default "Employee
 * (Self Service)") and a temporary password they must change, or, when the
 * email already has a login (e.g. the HR manager is also on payroll), that
 * login is linked and keeps its role. Used by the New employee form and by
 * "Give portal access" on the profile.
 */

export interface LoginRequest {
  email: string;
  roleId?: string;
  password?: string;
}

/** The sign-in fields of the employee form, normalised; null when no email was given. */
export function loginRequestFrom(side: Record<string, unknown> | undefined): LoginRequest | null {
  const email = String(side?.loginEmail ?? "").trim().toLowerCase();
  if (!email) return null;
  return { email, roleId: String(side?.loginRoleId ?? "").trim() || undefined, password: String(side?.loginPassword ?? "") || undefined };
}

async function roleFor(businessId: Types.ObjectId, roleId?: string) {
  if (!roleId) return selfServiceRole(businessId);
  if (!Types.ObjectId.isValid(roleId)) throw AppError.badRequest("Choose a role for the sign-in", "ROLE_NOT_FOUND");
  const role = await Role.findOne({ _id: roleId, businessId }).lean<AnyDoc>();
  if (!role) throw AppError.badRequest("Choose a role for the sign-in", "ROLE_NOT_FOUND");
  if (role.isActive === false) throw AppError.badRequest(`The role "${role.name}" is inactive`, "ROLE_INACTIVE");
  return role;
}

/**
 * Everything that could make the sign-in fail, checked before the employee is
 * saved so a bad email or password never leaves a half-made record behind.
 */
export async function checkLoginRequest(ctx: AuthContext, req: LoginRequest, employeeId?: Types.ObjectId) {
  if (!hasPermission(ctx, "users.create")) throw AppError.forbidden("Creating a sign-in needs permission to add team members (users.create).");
  const existing = await User.findOne({ businessId: ctx.businessId, email: req.email }).lean<AnyDoc>();
  if (existing) {
    const linked = await Employee.findOne({ businessId: ctx.businessId, userId: existing._id, deletedAt: null, ...(employeeId ? { _id: { $ne: employeeId } } : {}) }, { name: 1 }).lean<AnyDoc>();
    if (linked) throw AppError.conflict(`That sign-in is already linked to ${linked.name}`, "LOGIN_ALREADY_LINKED");
    return { existing: true as const };
  }
  if (!req.password) throw AppError.badRequest("Set a temporary password for the new sign-in", "PASSWORD_REQUIRED");
  if (req.password.length < 8 || !isPasswordStrongEnough(req.password)) {
    throw AppError.badRequest("The temporary password needs 8+ characters with an uppercase letter, lowercase letter, digit and symbol", "WEAK_PASSWORD");
  }
  await roleFor(ctx.businessId, req.roleId);
  return { existing: false as const };
}

/** Creates (or links) the sign-in and attaches it to the employee. */
export async function attachLogin(ctx: AuthContext, emp: AnyDoc, req: LoginRequest) {
  if (emp.userId) throw AppError.conflict("This employee already has a sign-in", "PORTAL_EXISTS");
  const check = await checkLoginRequest(ctx, req, emp._id);
  let user = check.existing ? await User.findOne({ businessId: ctx.businessId, email: req.email }) : null;
  let roleName = "";
  if (!user) {
    const role = await roleFor(ctx.businessId, req.roleId);
    roleName = role.name;
    user = await User.create({
      businessId: ctx.businessId,
      name: emp.name,
      username: await uniqueUsername(ctx.businessId, req.email),
      email: req.email,
      phone: emp.phone ?? "",
      passwordHash: await hashPassword(req.password!),
      roleId: role._id,
      status: "ACTIVE",
      isEmailVerified: false,
      mustChangePassword: true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    });
  }
  await Employee.updateOne({ _id: emp._id, businessId: ctx.businessId }, { userId: user._id, updatedBy: ctx.userId, ...(emp.workEmail ? {} : { workEmail: req.email }) });
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.employees",
    documentType: "Employee",
    documentId: emp._id,
    newValue: { portalEmail: req.email, newLogin: !check.existing, ...(roleName ? { role: roleName } : {}) },
  });
  return { email: req.email, created: !check.existing };
}

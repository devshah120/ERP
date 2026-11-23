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
 * An employee's sign-in. Two ways in:
 *  - the employee form's "Existing user" picker links a team member who
 *    already has a login (they keep their own role and password);
 *  - "Give portal access" on the profile creates a login with a chosen role
 *    (default "Employee (Self Service)") and a temporary password they must
 *    change, or links the login that email already has.
 */

export interface LoginRequest {
  email: string;
  roleId?: string;
  password?: string;
}

/**
 * What the employee form asked for its "Existing user" field: a user id to
 * link, "" to unlink, or undefined when the field was not sent (left alone).
 */
export function linkedUserFrom(side: Record<string, unknown> | undefined): string | undefined {
  if (!side || !("userId" in side) || side.userId === undefined) return undefined;
  return String(side.userId ?? "").trim();
}

/**
 * Everything that could make linking a team member fail, checked before the
 * employee is saved. `employeeId` is the employee being edited, if any.
 */
export async function checkUserLink(ctx: AuthContext, userId: string, employeeId?: Types.ObjectId) {
  if (!hasPermission(ctx, "users.view") || !hasPermission(ctx, "users.edit")) {
    throw AppError.forbidden("Linking a team member needs permission to view and edit team members (users.view, users.edit).");
  }
  if (!userId) return null;
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest("Choose a team member from the list", "USER_NOT_FOUND");
  const user = await User.findOne({ _id: userId, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!user) throw AppError.badRequest("Choose a team member from the list", "USER_NOT_FOUND");
  const linked = await Employee.findOne(
    { businessId: ctx.businessId, userId: user._id, deletedAt: null, ...(employeeId ? { _id: { $ne: employeeId } } : {}) },
    { name: 1 }
  ).lean<AnyDoc>();
  if (linked) throw AppError.conflict(`${user.name} is already linked to ${linked.name}`, "LOGIN_ALREADY_LINKED");
  return user;
}

/**
 * Links the chosen team member to the employee (or unlinks with ""). The login
 * itself is untouched: role, password and status stay as Team Members set them.
 */
export async function linkUser(ctx: AuthContext, emp: AnyDoc, userId: string) {
  const current = emp.userId ? String(emp.userId) : "";
  if (current === userId) return;
  const user = await checkUserLink(ctx, userId, emp._id);
  await Employee.updateOne(
    { _id: emp._id, businessId: ctx.businessId },
    { userId: user ? user._id : null, updatedBy: ctx.userId, ...(user?.email && !emp.workEmail ? { workEmail: user.email } : {}) }
  );
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.employees",
    documentType: "Employee",
    documentId: emp._id,
    oldValue: current ? { linkedUserId: current } : undefined,
    newValue: user ? { linkedUserId: String(user._id), portalEmail: user.email } : { linkedUserId: null },
    reason: user ? "Team member linked" : "Team member unlinked",
  });
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

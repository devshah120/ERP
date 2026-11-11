import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { User } from "@/models/User";
import { Role, OWNER_ALL_PERMISSIONS } from "@/models/Role";
import { Session } from "@/models/Session";
import { Business } from "@/models/Business";
import { hashPassword, isPasswordStrongEnough } from "@/lib/auth/password";
import { recordAudit } from "@/lib/services/auditService";
import { ALL_PERMISSION_KEYS } from "@/lib/auth/permissionCatalog";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/* ================================================================== */
/* Employees                                                           */
/* ================================================================== */

export const userCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,32}$/, "3–32 characters: letters, numbers, dot, underscore, hyphen"),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(7).max(20),
  roleId: z.string().trim().min(1, "Choose a role"),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .refine(isPasswordStrongEnough, "Include an uppercase letter, lowercase letter, digit and symbol"),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(7).max(20).optional(),
  roleId: z.string().trim().min(1).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

async function requireRole(businessId: Types.ObjectId, roleId: string) {
  if (!Types.ObjectId.isValid(roleId)) throw AppError.badRequest("Role not found", "ROLE_NOT_FOUND");
  const role = await Role.findOne({ _id: roleId, businessId }).lean<AnyDoc>();
  if (!role) throw AppError.badRequest("Role not found", "ROLE_NOT_FOUND");
  if (role.isActive === false) throw AppError.badRequest(`The role "${role.name}" is inactive`, "ROLE_INACTIVE");
  return role;
}

/** Ends every session a user has, so a role change or disable bites immediately. */
async function revokeSessions(businessId: Types.ObjectId, userId: Types.ObjectId) {
  await Session.updateMany({ businessId, userId, revokedAt: null }, { revokedAt: new Date() });
}

/**
 * Adds a colleague with a temporary password the owner hands over. They sign
 * in with the workspace domain, then change it from Forgot password.
 */
export async function createUser(input: z.infer<typeof userCreateSchema>, ctx: AuthContext) {
  await requireRole(ctx.businessId, input.roleId);

  const clash = await User.findOne({
    businessId: ctx.businessId,
    $or: [{ username: input.username }, { email: input.email }],
  }).lean<AnyDoc>();
  if (clash) {
    throw AppError.conflict(
      clash.username === input.username ? "That username is already taken" : "That email already has an account",
      "USER_EXISTS"
    );
  }

  const user = await User.create({
    businessId: ctx.businessId,
    name: input.name,
    username: input.username,
    email: input.email,
    phone: input.phone,
    passwordHash: await hashPassword(input.password),
    roleId: new Types.ObjectId(input.roleId),
    status: "ACTIVE",
    isEmailVerified: false,
    mustChangePassword: true,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "users",
    documentType: "User",
    documentId: user._id,
    newValue: { username: input.username, email: input.email, roleId: input.roleId },
  });

  const business = await Business.findById(ctx.businessId, { domain: 1 }).lean<AnyDoc>();
  return { id: user._id.toString(), username: user.username, domain: business?.domain ?? "" };
}

export async function updateUser(id: string, input: z.infer<typeof userUpdateSchema>, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Employee not found");
  const user = await User.findOne({ _id: id, businessId: ctx.businessId });
  if (!user) throw AppError.notFound("Employee not found");

  const isSelf = user._id.equals(ctx.userId);
  if (isSelf && input.status === "DISABLED") throw AppError.badRequest("You cannot disable your own account", "SELF_DISABLE");
  if (isSelf && input.roleId && input.roleId !== user.roleId.toString()) {
    throw AppError.badRequest("You cannot change your own role", "SELF_ROLE");
  }

  const before = { name: user.name, phone: user.phone, roleId: user.roleId.toString(), status: user.status };

  // Never leave the workspace without anyone who has full access.
  const currentRole = await Role.findOne({ _id: user.roleId, businessId: ctx.businessId }).lean<AnyDoc>();
  const losingFullAccess =
    currentRole?.permissions?.includes(OWNER_ALL_PERMISSIONS) &&
    (input.status === "DISABLED" || (input.roleId && input.roleId !== user.roleId.toString()));
  if (losingFullAccess) {
    const fullRoles = await Role.find({ businessId: ctx.businessId, permissions: OWNER_ALL_PERMISSIONS }, { _id: 1 }).lean<AnyDoc[]>();
    const others = await User.countDocuments({
      businessId: ctx.businessId,
      _id: { $ne: user._id },
      status: "ACTIVE",
      roleId: { $in: fullRoles.map((r) => r._id) },
    });
    if (others === 0) {
      throw AppError.badRequest("This is the only active user with full access. Give someone else full access first.", "LAST_OWNER");
    }
  }

  let mustRevoke = false;
  if (input.name) user.name = input.name;
  if (input.phone) user.phone = input.phone;
  if (input.roleId && input.roleId !== user.roleId.toString()) {
    await requireRole(ctx.businessId, input.roleId);
    user.roleId = new Types.ObjectId(input.roleId);
    mustRevoke = true;
  }
  if (input.status && input.status !== user.status) {
    // Re-enabling a locked account also clears the lock.
    if (input.status === "ACTIVE") {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
    }
    user.status = input.status;
    mustRevoke = mustRevoke || input.status === "DISABLED";
  }
  user.updatedBy = ctx.userId;
  await user.save();

  if (mustRevoke) await revokeSessions(ctx.businessId, user._id);

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "users",
    documentType: "User",
    documentId: user._id,
    oldValue: before,
    newValue: input,
  });

  return { id: user._id.toString() };
}

/* ================================================================== */
/* Roles                                                               */
/* ================================================================== */

const permissionList = z
  .array(z.string().trim())
  .max(1000)
  .transform((list) => [...new Set(list)])
  .refine((list) => list.every((p) => ALL_PERMISSION_KEYS.has(p)), "Unknown permission in the list");

export const roleCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: permissionList,
});

export const roleUpdateSchema = roleCreateSchema.partial().extend({ isActive: z.boolean().optional() });

export async function createRole(input: z.infer<typeof roleCreateSchema>, ctx: AuthContext) {
  const exists = await Role.exists({ businessId: ctx.businessId, name: input.name });
  if (exists) throw AppError.conflict(`A role called "${input.name}" already exists`, "ROLE_EXISTS");

  const role = await Role.create({
    businessId: ctx.businessId,
    name: input.name,
    description: input.description,
    permissions: input.permissions,
    isSystemRole: false,
    isActive: true,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "roles",
    documentType: "Role",
    documentId: role._id,
    newValue: { name: input.name, permissions: input.permissions.length },
  });
  return { id: role._id.toString() };
}

/**
 * System roles (Owner) are fixed: their full access is what guarantees the
 * workspace can always be administered.
 */
export async function updateRole(id: string, input: z.infer<typeof roleUpdateSchema>, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Role not found");
  const role = await Role.findOne({ _id: id, businessId: ctx.businessId });
  if (!role) throw AppError.notFound("Role not found");
  if (role.isSystemRole) throw AppError.badRequest(`"${role.name}" is a system role and cannot be changed`, "SYSTEM_ROLE");

  if (input.name && input.name !== role.name) {
    const exists = await Role.exists({ businessId: ctx.businessId, name: input.name, _id: { $ne: role._id } });
    if (exists) throw AppError.conflict(`A role called "${input.name}" already exists`, "ROLE_EXISTS");
    role.name = input.name;
  }
  if (input.description !== undefined) role.description = input.description;
  if (input.permissions) role.permissions = input.permissions;
  if (input.isActive !== undefined) role.isActive = input.isActive;
  role.updatedBy = ctx.userId;
  await role.save();

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "roles",
    documentType: "Role",
    documentId: role._id,
    newValue: { name: role.name, permissions: role.permissions.length, isActive: role.isActive },
  });
  return { id: role._id.toString() };
}

export async function deleteRole(id: string, ctx: AuthContext) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Role not found");
  const role = await Role.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!role) throw AppError.notFound("Role not found");
  if (role.isSystemRole) throw AppError.badRequest(`"${role.name}" is a system role and cannot be deleted`, "SYSTEM_ROLE");

  const members = await User.countDocuments({ businessId: ctx.businessId, roleId: role._id });
  if (members > 0) {
    throw AppError.badRequest(
      `${members} employee${members === 1 ? " has" : "s have"} this role. Move them to another role first.`,
      "ROLE_IN_USE"
    );
  }

  await Role.deleteOne({ _id: role._id, businessId: ctx.businessId });
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "DELETE",
    module: "roles",
    documentType: "Role",
    documentId: role._id,
    oldValue: { name: role.name },
  });
}

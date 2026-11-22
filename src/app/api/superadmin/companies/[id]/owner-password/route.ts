import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { AppError } from "@/lib/errors/AppError";
import { hashPassword, isPasswordStrongEnough } from "@/lib/auth/password";
import { recordAudit } from "@/lib/services/auditService";
import { Role, OWNER_ROLE_NAME } from "@/models/Role";
import { User } from "@/models/User";
import { Session } from "@/models/Session";
import "@/models";

const schema = z.object({
  password: z
    .string()
    .min(8, "At least 8 characters")
    .refine(isPasswordStrongEnough, "Include an uppercase letter, lowercase letter, digit and symbol"),
});

/**
 * Sets a new temporary password on the workspace owner's login, for when a
 * customer is locked out. Unlocks the account, signs it out everywhere and
 * asks for a password change at next sign-in.
 */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  getSAContext(req);
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Company not found");
  const { password } = schema.parse(await req.json());

  const businessId = new Types.ObjectId(id);
  const ownerRole = await Role.findOne({ businessId, name: OWNER_ROLE_NAME }, { _id: 1 }).lean<{ _id: Types.ObjectId }>();
  if (!ownerRole) throw AppError.notFound("This company has no owner role");
  const owner = await User.findOne({ businessId, roleId: ownerRole._id }).sort({ createdAt: 1 });
  if (!owner) throw AppError.notFound("This company has no owner login");

  owner.passwordHash = await hashPassword(password);
  owner.failedLoginAttempts = 0;
  owner.lockedUntil = null;
  owner.mustChangePassword = true;
  if (owner.status === "LOCKED" || owner.status === "PENDING_VERIFICATION") owner.status = "ACTIVE";
  if (owner.status === "ACTIVE") owner.isEmailVerified = true;
  await owner.save();
  await Session.updateMany({ businessId, userId: owner._id, revokedAt: null }, { revokedAt: new Date() });

  await recordAudit({
    businessId,
    userId: null,
    action: "PASSWORD_CHANGE",
    module: "superadmin",
    documentType: "User",
    documentId: owner._id,
    reason: "Owner password reset by the product owner",
  });

  return ok({ email: owner.email }, "Owner password reset");
});

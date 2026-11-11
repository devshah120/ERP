import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/cookies";

export interface AuthContext {
  userId: Types.ObjectId;
  businessId: Types.ObjectId;
  roleId: Types.ObjectId;
  permissions: string[];
  branchIds: Types.ObjectId[];
  warehouseIds: Types.ObjectId[];
}

/** Reads and verifies the access token cookie. Throws 401 if missing/invalid/expired. */
export function getAuthContext(req: NextRequest): AuthContext {
  const token = req.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) throw AppError.unauthorized();

  try {
    const payload = verifyAccessToken(token);
    return {
      userId: new Types.ObjectId(payload.sub),
      businessId: new Types.ObjectId(payload.businessId),
      roleId: new Types.ObjectId(payload.roleId),
      permissions: payload.permissions,
      branchIds: payload.branchIds.map((id) => new Types.ObjectId(id)),
      warehouseIds: payload.warehouseIds.map((id) => new Types.ObjectId(id)),
    };
  } catch {
    throw AppError.unauthorized("Session expired, please log in again", "SESSION_EXPIRED");
  }
}

/** Throws 403 if the auth context lacks the given permission. "*" grants everything (Owner role). */
export function requirePermission(ctx: AuthContext, permission: string): void {
  if (ctx.permissions.includes("*") || ctx.permissions.includes(permission)) return;
  throw AppError.forbidden(`Missing required permission: ${permission}`);
}

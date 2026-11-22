import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/cookies";
import { normalizeProducts, productForPermission, PRODUCT_SHORT_LABELS, type Product } from "@/lib/products";

export interface AuthContext {
  userId: Types.ObjectId;
  businessId: Types.ObjectId;
  roleId: Types.ObjectId;
  permissions: string[];
  branchIds: Types.ObjectId[];
  warehouseIds: Types.ObjectId[];
  /** Products the workspace has bought; gates whole modules regardless of role. */
  products: Product[];
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
      products: normalizeProducts(payload.products),
    };
  } catch {
    throw AppError.unauthorized("Session expired, please log in again", "SESSION_EXPIRED");
  }
}

/**
 * Throws 403 if the auth context lacks the given permission. "*" grants
 * everything (Owner role) — but only within the products the workspace has
 * bought, so an HRMS-only customer's owner cannot reach ERP APIs and vice versa.
 */
export function requirePermission(ctx: AuthContext, permission: string): void {
  requireProductFor(ctx, permission);
  if (ctx.permissions.includes("*") || ctx.permissions.includes(permission)) return;
  throw AppError.forbidden(`Missing required permission: ${permission}`);
}

/** Throws 403 when the permission's module belongs to a product this workspace has not bought. */
export function requireProductFor(ctx: AuthContext, permission: string): void {
  const product = productForPermission(permission);
  if (product && !ctx.products.includes(product)) {
    throw AppError.forbidden(`Your subscription does not include ${PRODUCT_SHORT_LABELS[product]}`, "PRODUCT_NOT_ENABLED");
  }
}

/** True when the context holds the permission, without throwing. */
export function hasPermission(ctx: AuthContext, permission: string): boolean {
  const product = productForPermission(permission);
  if (product && !ctx.products.includes(product)) return false;
  return ctx.permissions.includes("*") || ctx.permissions.includes(permission);
}

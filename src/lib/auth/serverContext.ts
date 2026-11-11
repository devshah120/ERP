import { cookies } from "next/headers";
import { Types } from "mongoose";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/cookies";
import type { AuthContext } from "@/lib/auth/context";

/**
 * Same auth context as `getAuthContext`, but read from the request cookies
 * inside a Server Component (where there is no NextRequest to hand).
 *
 * Returns null instead of throwing, so a page can decide whether to redirect
 * to login or render a signed-out state.
 */
export async function getServerAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

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
    return null;
  }
}

import { cookies } from "next/headers";
import { verifyAccessToken } from "@/lib/auth/tokens";
import { ACCESS_TOKEN_COOKIE } from "@/lib/auth/cookies";
import { contextFromPayload, type AuthContext } from "@/lib/auth/context";

/**
 * Same auth context as `getAuthContext`, but read from the request cookies
 * inside a Server Component (where there is no NextRequest to hand).
 *
 * Returns null instead of throwing, so a page can decide whether to redirect
 * to login or render a signed-out state. A user who still has to replace a
 * temporary password counts as signed out here.
 */
export async function getServerAuthContext(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(ACCESS_TOKEN_COOKIE)?.value;
  if (!token) return null;

  try {
    const ctx = contextFromPayload(verifyAccessToken(token));
    return ctx.mustChangePassword ? null : ctx;
  } catch {
    return null;
  }
}

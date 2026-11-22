import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { getAuthContext } from "@/lib/auth/context";
import { setAuthCookies, SESSION_ONLY_COOKIE } from "@/lib/auth/cookies";
import { changePasswordSchema } from "@/lib/validation/authSchemas";
import { changePassword } from "@/lib/services/authService";
import "@/models";

/**
 * Signed-in password change. Also the one route (with /api/auth/me) a user
 * holding a temporary password can reach. Signs out every other session and
 * sets fresh cookies for this one.
 */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req, { allowPasswordChangePending: true });
  const meta = getRequestMeta(req);
  enforceRateLimit(`change-password:${ctx.userId.toString()}`, 5, 60_000);

  const input = changePasswordSchema.parse(await req.json());
  const tokens = await changePassword(ctx.userId, ctx.businessId, input, meta);

  const res = ok(null, "Password changed. Other devices have been signed out.");
  // Keep whatever the user chose at sign-in ("Remember me" or not).
  const sessionOnly = req.cookies.get(SESSION_ONLY_COOKIE)?.value === "0";
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, { persistent: !sessionOnly });
  return res;
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { setAuthCookies, REFRESH_TOKEN_COOKIE, SESSION_ONLY_COOKIE } from "@/lib/auth/cookies";
import { refreshSession } from "@/lib/services/authService";
import { AppError } from "@/lib/errors/AppError";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refreshToken) throw AppError.unauthorized("No active session", "SESSION_EXPIRED");

  const meta = getRequestMeta(req);
  const tokens = await refreshSession(refreshToken, meta);

  const res = ok(null, "Session refreshed");
  // Keep whatever the user chose at sign-in ("Remember me" or not).
  const sessionOnly = req.cookies.get(SESSION_ONLY_COOKIE)?.value === "0";
  setAuthCookies(res, tokens.accessToken, tokens.refreshToken, { persistent: !sessionOnly });
  return res;
});

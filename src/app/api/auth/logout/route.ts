import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { clearAuthCookies, REFRESH_TOKEN_COOKIE } from "@/lib/auth/cookies";
import { logout } from "@/lib/services/authService";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const refreshToken = req.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  await logout(refreshToken);

  const res = ok(null, "Logged out successfully");
  clearAuthCookies(res);
  return res;
});

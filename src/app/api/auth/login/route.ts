import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { setAuthCookies } from "@/lib/auth/cookies";
import { loginSchema } from "@/lib/validation/authSchemas";
import { login } from "@/lib/services/authService";
import { isSuperAdminEmail, verifySuperAdminCredentials } from "@/lib/auth/superAdminCredentials";
import { signSAToken } from "@/lib/auth/superAdminTokens";
import { setSACookie } from "@/lib/auth/superAdminContext";
import { AppError } from "@/lib/errors/AppError";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const meta = getRequestMeta(req);
  enforceRateLimit(`login:${meta.ip ?? "unknown"}`, 10, 60_000);

  const body = await req.json();
  const input = loginSchema.parse(body);

  // If Super Admin logs in via the main login screen, seamlessly authenticate & redirect them
  if (isSuperAdminEmail(input.email)) {
    if (!(await verifySuperAdminCredentials(input.email, input.password))) {
      throw AppError.unauthorized("Invalid email or password", "INVALID_CREDENTIALS");
    }
    const token = signSAToken();
    const res = ok({ superAdmin: true, redirectTo: "/superadmin/dashboard" }, "Super Admin logged in successfully");
    setSACookie(res, token);
    return res;
  }

  const result = await login(input, meta);

  const res = ok({ user: result.user }, "Logged in successfully");
  setAuthCookies(res, result.accessToken, result.refreshToken, { persistent: input.rememberMe });
  return res;
});

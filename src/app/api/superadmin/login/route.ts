import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { signSAToken } from "@/lib/auth/superAdminTokens";
import { setSACookie } from "@/lib/auth/superAdminContext";
import { verifySuperAdminCredentials } from "@/lib/auth/superAdminCredentials";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { AppError } from "@/lib/errors/AppError";
import { fail } from "@/lib/http/response";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const meta = getRequestMeta(req);
    enforceRateLimit(`sa-login:${meta.ip ?? "unknown"}`, 10, 60_000);

    const { email, password } = schema.parse(await req.json());
    if (!(await verifySuperAdminCredentials(email, password))) {
      return fail("Invalid email or password.", 401, "SA_INVALID_CREDENTIALS");
    }

    const token = signSAToken();
    const res = NextResponse.json({ success: true, data: { email: email.trim().toLowerCase() } }, { status: 200 });
    setSACookie(res, token);
    return res;
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 429) {
      return fail("Too many sign-in attempts. Try again in a minute.", 429, "RATE_LIMITED");
    }
    return fail("Invalid request.", 400, "BAD_REQUEST");
  }
}

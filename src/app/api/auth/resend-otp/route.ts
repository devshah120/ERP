import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { resendOtpSchema } from "@/lib/validation/authSchemas";
import { resendRegistrationOtp } from "@/lib/services/authService";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const { ip } = getRequestMeta(req);
  enforceRateLimit(`resend-otp:${ip ?? "unknown"}`, 5, 60_000);

  const body = await req.json();
  const input = resendOtpSchema.parse(body);

  const result = await resendRegistrationOtp(input.businessId);

  return ok(result, "A new verification code has been sent.");
});

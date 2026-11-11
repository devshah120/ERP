import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { verifyOtpSchema } from "@/lib/validation/authSchemas";
import { verifyRegistrationOtp } from "@/lib/services/authService";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const { ip } = getRequestMeta(req);
  enforceRateLimit(`verify-otp:${ip ?? "unknown"}`, 15, 60_000);

  const body = await req.json();
  const input = verifyOtpSchema.parse(body);

  await verifyRegistrationOtp(input.businessId, input.code, ip);

  return ok(null, "Business verified successfully. You can now log in.");
});

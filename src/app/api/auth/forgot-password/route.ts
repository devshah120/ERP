import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { forgotPasswordSchema } from "@/lib/validation/authSchemas";
import { requestPasswordReset } from "@/lib/services/authService";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const { ip } = getRequestMeta(req);
  enforceRateLimit(`forgot-password:${ip ?? "unknown"}`, 5, 60_000);

  const input = forgotPasswordSchema.parse(await req.json());
  await requestPasswordReset(input, ip);

  // Identical response whether or not the account exists.
  return ok(null, "If that account exists, a reset code has been sent to its email address.");
});

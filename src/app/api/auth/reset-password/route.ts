import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { resetPasswordSchema } from "@/lib/validation/authSchemas";
import { resetPassword } from "@/lib/services/authService";
import "@/models";

export const POST = withApiHandler(async (req: NextRequest) => {
  const { ip } = getRequestMeta(req);
  enforceRateLimit(`reset-password:${ip ?? "unknown"}`, 10, 60_000);

  const input = resetPasswordSchema.parse(await req.json());
  await resetPassword(input, ip);

  return ok(null, "Password updated. Sign in with your new password.");
});

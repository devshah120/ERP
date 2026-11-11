import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { created } from "@/lib/http/response";
import { getRequestMeta } from "@/lib/http/requestMeta";
import { enforceRateLimit } from "@/lib/http/rateLimit";
import { registerSchema } from "@/lib/validation/authSchemas";
import { registerBusiness } from "@/lib/services/authService";
import "@/models"; // ensure all schemas are registered

export const POST = withApiHandler(async (req: NextRequest) => {
  const { ip } = getRequestMeta(req);
  enforceRateLimit(`register:${ip ?? "unknown"}`, 5, 60_000);

  const body = await req.json();
  const input = registerSchema.parse(body);

  const result = await registerBusiness(input, ip);

  return created(result, "Business registered. Please check your email for a verification code.");
});

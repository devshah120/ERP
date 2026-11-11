import { NextRequest } from "next/server";

export function getRequestMeta(req: NextRequest): { ip?: string; userAgent?: string } {
  const forwardedFor = req.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  return { ip, userAgent };
}

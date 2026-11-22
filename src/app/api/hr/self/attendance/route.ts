import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { myAttendance } from "@/lib/hr/attendance";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const sp = req.nextUrl.searchParams;
  const now = new Date();
  const year = Number(sp.get("year")) || now.getUTCFullYear();
  const month = Number(sp.get("month")) || now.getUTCMonth() + 1;
  return ok(await myAttendance(ctx, year, Math.min(12, Math.max(1, month))));
});

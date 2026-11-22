import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { gratuityReport } from "@/lib/hr/fnf";

/** Gratuity accrued and payable for everyone on the rolls on ?asOf=yyyy-mm-dd (default today). */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const asOf = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(new Date().toISOString().slice(0, 10))
    .parse(req.nextUrl.searchParams.get("asOf") ?? undefined);
  return ok(await gratuityReport(ctx, asOf));
});

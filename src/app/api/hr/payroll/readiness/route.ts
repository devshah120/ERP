import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { payrollReadiness } from "@/lib/hr/payroll";
import { monthQuery } from "@/lib/hr/common";

/** What would stop a clean payroll for a month: missing salary or bank details, pending leave, unmarked attendance. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const sp = req.nextUrl.searchParams;
  const { year, month } = monthQuery.parse({ year: sp.get("year"), month: sp.get("month") });
  return ok(await payrollReadiness(ctx, year, month));
});

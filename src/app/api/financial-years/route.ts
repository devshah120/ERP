import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listFinancialYears, openNextFinancialYear } from "@/lib/services/financialYearAdmin";
import "@/models";

/** Any signed-in user can see the years (the header switcher lists them). */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  return ok(await listFinancialYears(ctx.businessId));
});

/** Opens the next financial year. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "financial-years.manage");
  const fy = await openNextFinancialYear(ctx);
  return created(fy, `Financial year ${fy.label} opened`);
});

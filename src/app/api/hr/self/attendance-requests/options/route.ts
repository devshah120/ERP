import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { ok } from "@/lib/http/response";
import { regularizationOptions } from "@/lib/hr/regularization";
import { businessTimeZone } from "@/lib/hr/common";
import { todayIn } from "@/lib/hr/calendar";

/** The reasons and the dates and times the regularization policy allows, for the employee's request form. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  return ok(await regularizationOptions(ctx.businessId, todayIn(await businessTimeZone(ctx.businessId))));
});

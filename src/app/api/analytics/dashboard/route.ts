import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { analyticsQuerySchema } from "@/lib/analytics/types";
import { buildDashboard } from "@/lib/analytics/dashboard";
import "@/models";

/**
 * Every figure is scoped to the caller's business by `ctx.businessId`, which
 * comes from the signed access token — a client cannot ask for another
 * tenant's dashboard by changing a query parameter.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  const query = analyticsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));

  return ok(await buildDashboard(ctx.businessId, query));
});

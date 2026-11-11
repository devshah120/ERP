import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { analyticsQuerySchema } from "@/lib/analytics/types";
import { runOverview } from "@/lib/analytics/overview";
import "@/models";

/**
 * Dashboard operational panels (deltas, payment modes, aging by party,
 * customer segments, category mix, item performance). Purchase-side figures
 * are only included for roles that can see purchase invoices.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "sales-invoices.view");
  const canPurchase = ctx.permissions.includes("*") || ctx.permissions.includes("purchase-invoices.view");

  const query = analyticsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return ok(await runOverview(ctx.businessId, query, { purchase: canPurchase }));
});

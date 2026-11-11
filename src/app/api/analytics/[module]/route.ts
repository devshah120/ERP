import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { analyticsQuerySchema } from "@/lib/analytics/types";
import { runModuleAnalysis } from "@/lib/analytics/modules";
import "@/models";

/**
 * Per-module analysis. The permission checked is the module's own view
 * permission, so someone who cannot see purchase documents cannot read the
 * purchase figures through the analysis endpoint either.
 */
const MODULE_PERMISSION: Record<string, string> = {
  sales: "sales-invoices.view",
  purchase: "purchase-invoices.view",
  inventory: "items.view",
  customers: "customers.view",
  vendors: "vendors.view",
  accounting: "sales-invoices.view",
};

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { module } = await params;
  const ctx = getAuthContext(req);

  const permission = MODULE_PERMISSION[module];
  if (permission) requirePermission(ctx, permission);

  const query = analyticsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return ok(await runModuleAnalysis(module, ctx.businessId, query));
});

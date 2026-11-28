import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { ANALYSIS_PERMISSIONS, analysisPermission } from "@/lib/auth/permissionCatalog";
import { analyticsQuerySchema } from "@/lib/analytics/types";
import { runModuleAnalysis } from "@/lib/analytics/modules";
import "@/models";

/**
 * Per-module analysis. Each screen has its own permission
 * (analysis-<module>.view, Roles & Permissions → Analyze → Deep Dives).
 */
const KNOWN = new Set(ANALYSIS_PERMISSIONS.map((a) => a.key));

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { module } = await params;
  const ctx = getAuthContext(req);

  if (KNOWN.has(module)) requirePermission(ctx, analysisPermission(module));

  const query = analyticsQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return ok(await runModuleAnalysis(module, ctx.businessId, query));
});

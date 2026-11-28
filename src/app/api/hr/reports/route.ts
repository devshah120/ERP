import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, hasPermission } from "@/lib/auth/context";
import { hrReportPermission } from "@/lib/auth/permissionCatalog";
import "@/models";
import { HR_REPORTS } from "@/lib/hr/insights";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  // Each HR report has its own permission; list only the ones this role may open.
  return ok({ items: HR_REPORTS.filter((r) => hasPermission(ctx, hrReportPermission(r.key))) });
});

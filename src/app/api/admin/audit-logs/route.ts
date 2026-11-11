import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { auditQuerySchema, listAuditLogs } from "@/lib/services/adminService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "audit-logs.view");
  const query = auditQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
  return ok(await listAuditLogs(ctx.businessId, query));
});

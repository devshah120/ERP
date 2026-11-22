import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listTeamLeaves, leaveListSchema } from "@/lib/hr/leave";

/** Leave requests of the signed-in employee's direct reports. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  return ok(await listTeamLeaves(ctx, leaveListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

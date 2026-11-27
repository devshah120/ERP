import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, hasPermission } from "@/lib/auth/context";
import { approvalQueue, queueSchema } from "@/lib/approvals/service";
import "@/models";

/**
 * Approvals waiting for the signed-in user (scope=mine, the default), ones
 * they raised (scope=raised), or every one (scope=all, needs approvals.view).
 * Any signed-in user may see their own queue: approvers are named in schemes,
 * not by role.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  const params = queueSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  return ok(await approvalQueue(ctx, params, hasPermission(ctx, "approvals.view")));
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { pickableUsers } from "@/lib/approvals/service";
import "@/models";

/** Users who can be named as approvers or added to a group. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.view");
  return ok(await pickableUsers(ctx));
});

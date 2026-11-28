import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { pickableRoles } from "@/lib/approvals/service";
import "@/models";

/** Roles that can be named as a "Designated Role" approver, with how many active users hold each. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.view");
  return ok(await pickableRoles(ctx));
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { orgTree } from "@/lib/hr/orgTree";

/** Everyone on the rolls with their reporting manager, for the organization tree. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employees.view");
  return ok(await orgTree(ctx));
});

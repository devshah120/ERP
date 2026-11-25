import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { contractorTree } from "@/lib/hr/contractLabour";

/** Every contractor under the contractor it works for, with its worker count. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-contractors.view");
  return ok(await contractorTree(ctx));
});

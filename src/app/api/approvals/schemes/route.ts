import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listSchemes } from "@/lib/approvals/service";
import "@/models";

/** Every document of the workspace's products, with its scheme if one is saved. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.view");
  return ok(await listSchemes(ctx));
});

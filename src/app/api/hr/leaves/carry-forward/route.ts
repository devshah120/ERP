import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { carryForwardLeave, carryForwardSchema } from "@/lib/hr/leave";

/** Year-end carry-forward: { fromYear, commit: false } previews, { commit: true } writes next year's carried days. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leaves.allocate");
  const input = carryForwardSchema.parse(await req.json());
  const result = await carryForwardLeave(ctx, input);
  return ok(result, result.committed ? `Carried forward into ${result.toYear}` : undefined);
});

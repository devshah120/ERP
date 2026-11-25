import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { contractorWorkers } from "@/lib/hr/contractLabour";

/** ?contractorId=: the active workers of one contractor. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-contract-workers.view");
  return ok(await contractorWorkers(ctx, req.nextUrl.searchParams.get("contractorId") ?? ""));
});

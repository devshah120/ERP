import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { balancesTable, setAllocation, allocationSchema } from "@/lib/hr/leave";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leaves.view");
  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year")) || new Date().getUTCFullYear();
  return ok(await balancesTable(ctx, year, sp.get("query") || undefined));
});

/** Sets one employee's days for a leave type and year (overrides the type's quota). */
export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leaves.allocate");
  return okOrHeld(await setAllocation(ctx, allocationSchema.parse(await req.json())), "Leave allocation saved");
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { settleClaims, claimSettlementSchema } from "@/lib/hr/money";

/** Pays approved claims directly (cash, bank or cheque) instead of with payroll. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.approve");
  const result = await settleClaims(ctx, claimSettlementSchema.parse(await req.json()));
  return ok(result, `${result.settled} claim(s) settled`);
});

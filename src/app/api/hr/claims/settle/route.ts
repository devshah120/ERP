import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { settleClaims, claimSettlementSchema } from "@/lib/hr/money";

/** Pays approved claims directly (cash, bank or cheque) instead of with payroll. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.approve");
  const result = await settleClaims(ctx, claimSettlementSchema.parse(await req.json()));
  return okOrHeld(result, (r) => (r.payroll ? `${r.scheduled} claim(s) will be paid in ${r.payroll} payroll` : `${r.settled} claim(s) settled`));
});

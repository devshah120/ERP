import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { payrollVouchers, postMissingPayrollVouchers } from "@/lib/hr/payrollPosting";
import { objectId } from "@/lib/hr/common";

/** Approved and paid payroll with the journal vouchers posted for it. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  return ok(await payrollVouchers(ctx));
});

/** Posts the vouchers a run is missing (e.g. approved before the chart of accounts existed). */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.approve");
  const { runId } = z.object({ runId: objectId }).parse(await req.json());
  const result = await postMissingPayrollVouchers(ctx, runId);
  return ok(result, result.posted.length ? `Posted ${result.posted.join(", ")}` : "Nothing was missing");
});

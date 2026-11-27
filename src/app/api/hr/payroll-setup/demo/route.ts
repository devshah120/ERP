import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { createPayrollDemo } from "@/lib/hr/payrollDemo";

/** HR Settings → "Create demo data": a sample salary structure and (inactive) PT slabs. Idempotent. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const result = await createPayrollDemo(ctx);
  return ok(result, result.created.length > 0 ? `Created ${result.created.join(" and ")}` : "The demo data is already there");
});

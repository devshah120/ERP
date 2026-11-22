import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listLoans, loanListSchema } from "@/lib/hr/money";
import { selfEmployee } from "@/lib/hr/common";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  return ok(await listLoans(ctx, loanListSchema.parse(Object.fromEntries(req.nextUrl.searchParams)), { employeeId: emp._id }));
});

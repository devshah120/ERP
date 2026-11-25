import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listLoans, loanListSchema, requestAdvance, advanceRequestSchema } from "@/lib/hr/money";
import { selfEmployee } from "@/lib/hr/common";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  return ok(await listLoans(ctx, loanListSchema.parse(Object.fromEntries(req.nextUrl.searchParams)), { employeeId: emp._id }));
});

/** The employee asks for a salary advance or loan; HR approves it before anything is issued. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const result = await requestAdvance(ctx, advanceRequestSchema.parse(await req.json()), { self: true });
  return created(result, `Request ${result.loanNumber} sent to HR`);
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listLoans, loanListSchema, createLoan, loanCreateSchema } from "@/lib/hr/money";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-loans.view");
  return ok(await listLoans(ctx, loanListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-loans.create");
  const result = await createLoan(ctx, loanCreateSchema.parse(await req.json()));
  return okOrHeld(result, (r) => `Loan ${r.loanNumber} recorded`, 201);
});

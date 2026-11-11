import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listExpenses, createExpense, expenseCreateSchema, expenseOptions } from "@/lib/expenses/service";
import "@/models";

/** ?options=1 returns the account pickers for the form instead of the list. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "expenses.view");
  if (req.nextUrl.searchParams.get("options")) return ok(await expenseOptions(ctx.businessId));
  return ok(await listExpenses(req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "expenses.create");
  const input = expenseCreateSchema.parse(await req.json());
  return created(await createExpense(input, ctx), "Expense recorded");
});

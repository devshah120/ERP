import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getExpense, cancelExpense } from "@/lib/expenses/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "expenses.view");
  return ok(await getExpense(id, ctx));
});

/** Cancelling reverses the journal entry; the expense stays on record. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "expenses.cancel");
  const { reason } = z.object({ reason: z.string().trim().min(1, "A reason is required").max(500) }).parse(await req.json());
  return ok(await cancelExpense(id, reason, ctx), "Expense cancelled");
});

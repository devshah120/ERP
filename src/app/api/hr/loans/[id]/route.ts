import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { z } from "zod";
import { getLoan, recordRepayment, cancelLoan, repaymentSchema } from "@/lib/hr/money";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-loans.view");
  const { id } = await params;
  return ok(await getLoan(ctx, id));
});

const actionSchema = z.object({ action: z.enum(["repay", "cancel"]) }).passthrough();

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  const { id } = await params;
  const body = await req.json();
  const { action } = actionSchema.parse(body);
  if (action === "repay") {
    requirePermission(ctx, "hr-loans.create");
    return ok(await recordRepayment(ctx, id, repaymentSchema.parse(body)), "Repayment recorded");
  }
  requirePermission(ctx, "hr-loans.cancel");
  return ok(await cancelLoan(ctx, id), "Loan cancelled");
});

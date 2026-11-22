import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { z } from "zod";
import { getRun, recomputeRun, approveRun, markRunPaid, cancelRun, approveRunSchema, payRunSchema, cancelRunSchema } from "@/lib/hr/payroll";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const { id } = await params;
  return ok(await getRun(ctx, id));
});

const actionSchema = z.object({ action: z.enum(["recompute", "approve", "pay", "cancel"]) }).passthrough();

/** Workflow: recompute (draft), approve (locks the month), pay. Cancel reverses an approved run or deletes a draft. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  const { id } = await params;
  const body = await req.json();
  const { action } = actionSchema.parse(body);
  if (action === "recompute") {
    requirePermission(ctx, "hr-payroll.process");
    return ok(await recomputeRun(ctx, id), "Payroll recalculated");
  }
  requirePermission(ctx, "hr-payroll.approve");
  if (action === "approve") return ok(await approveRun(ctx, id, approveRunSchema.parse(body)), "Payroll approved");
  if (action === "pay") return ok(await markRunPaid(ctx, id, payRunSchema.parse(body)), "Payroll marked paid");
  const result = await cancelRun(ctx, id, cancelRunSchema.parse(body).reason);
  return ok(result, result.status === "DELETED" ? "Draft payroll deleted" : "Payroll cancelled");
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okDecision } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/AppError";
import "@/models";
import { getFnf, updateFnf, updateFnfSchema, approveFnf, markFnfPaid, payFnfSchema, cancelFnf } from "@/lib/hr/fnf";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const { id } = await params;
  return ok(await getFnf(ctx, id));
});

/** Recalculates a draft, with new notice terms, manual lines or notes. */
export const PUT = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const { id } = await params;
  return ok(await updateFnf(ctx, id, updateFnfSchema.parse(await req.json())), "Settlement recalculated");
});

const actionSchema = z.object({ action: z.enum(["approve", "pay", "cancel"]), reason: z.string().trim().max(500).optional().default("") }).passthrough();

/** approve (recovers loans, records the exit), pay, cancel. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.approve");
  const { id } = await params;
  const body = await req.json();
  const { action, reason } = actionSchema.parse(body);
  if (action === "approve") return okDecision(await approveFnf(ctx, id), "Settlement approved");
  if (action === "pay") return ok(await markFnfPaid(ctx, id, payFnfSchema.parse(body)), "Settlement marked paid");
  if (reason.length < 3) throw AppError.badRequest("Give a reason for cancelling", "REASON_REQUIRED");
  const r = await cancelFnf(ctx, id, reason);
  return ok(r, r.status === "DELETED" ? "Draft deleted" : "Settlement cancelled");
});

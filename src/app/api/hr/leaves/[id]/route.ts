import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { z } from "zod";
import { approveLeave, rejectLeave, cancelLeave } from "@/lib/hr/leave";

const actionSchema = z.object({ action: z.enum(["approve", "reject", "cancel"]), note: z.string().trim().max(500).optional().default("") });

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leaves.approve");
  const { id } = await params;
  const { action, note } = actionSchema.parse(await req.json());
  if (action === "approve") return ok(await approveLeave(ctx, id, note), "Leave approved");
  if (action === "reject") return ok(await rejectLeave(ctx, id, note), "Leave rejected");
  return ok(await cancelLeave(ctx, id, { self: false, note }), "Leave cancelled");
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { okDecision } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { decideTeamLeave } from "@/lib/hr/leave";

const actionSchema = z.object({ action: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional().default("") });

/** A reporting manager approves or rejects a direct report's pending leave. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const { id } = await params;
  const { action, note } = actionSchema.parse(await req.json());
  return okDecision(await decideTeamLeave(ctx, id, action, note), action === "approve" ? "Leave approved" : "Leave rejected");
});

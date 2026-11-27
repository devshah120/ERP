import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { okDecision } from "@/lib/approvals/http";
import { decideTeamCorrection, decideCorrectionSchema } from "@/lib/hr/corrections";

/** A reporting manager approves or rejects a direct report's correction request. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const { id } = await params;
  const { action, note } = decideCorrectionSchema.parse(await req.json());
  return okDecision(await decideTeamCorrection(ctx, id, action, note), action === "approve" ? "Correction approved" : "Correction rejected");
});

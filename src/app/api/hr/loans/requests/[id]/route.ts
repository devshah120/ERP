import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { decideAdvance, advanceDecisionSchema } from "@/lib/hr/money";

/** Approve (issuing the advance, possibly with a changed amount, instalment or start) or reject a request. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  // Approving issues money, the same power as issuing a loan directly.
  requirePermission(ctx, "hr-loans.create");
  const { id } = await params;
  const input = advanceDecisionSchema.parse(await req.json());
  const result = await decideAdvance(ctx, id, input);
  return ok(result, input.action === "approve" ? "Advance approved and issued" : "Request rejected");
});

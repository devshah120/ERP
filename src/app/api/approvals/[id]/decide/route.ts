import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { requestForAction } from "@/lib/approvals/service";
import { actOnApproval } from "@/lib/approvals/adapters";
import { AppError } from "@/lib/errors/AppError";
import "@/models";

const bodySchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional().default(""),
});

/** The current stage's approver approves or rejects from the queue. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  const { action, note } = bodySchema.parse(await req.json());
  if (action === "reject" && note.length < 3) throw AppError.badRequest("Give a reason for rejecting", "REASON_REQUIRED");
  // Checks the request is open and this user is its current approver before anything runs.
  const request = await requestForAction(ctx, id);
  const result = await actOnApproval(ctx, request, action, note);
  return ok(result, result?.approvalMessage ?? (action === "approve" ? "Approved" : "Rejected"));
});

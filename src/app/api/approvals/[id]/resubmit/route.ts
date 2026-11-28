import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/AppError";
import { ApprovalRequest } from "@/models/approval";
import { resubmit } from "@/lib/approvals/adapters";
import "@/models";

const bodySchema = z.object({ note: z.string().trim().max(500).optional().default("") });

/** The requester sends a sent-back change again, as it was, with an optional note. Approval starts again from stage 1. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  const { note } = bodySchema.parse(await req.json().catch(() => ({})));
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Approval not found");
  const found = await ApprovalRequest.findOne({ _id: id, businessId: ctx.businessId }, { document: 1 }).lean<{ document: string }>();
  if (!found) throw AppError.notFound("Approval not found");
  const result = await resubmit(ctx, id, found.document, note);
  return ok(result, result.approvalMessage);
});

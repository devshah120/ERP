import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { ok } from "@/lib/http/response";
import { approveCorrection, rejectCorrection, decideCorrectionSchema } from "@/lib/hr/corrections";

/** HR approves (writes the day to attendance) or rejects a correction request. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.edit");
  const { id } = await params;
  const { action, note } = decideCorrectionSchema.parse(await req.json());
  return ok(action === "approve" ? await approveCorrection(ctx, id, note) : await rejectCorrection(ctx, id, note), action === "approve" ? "Correction approved" : "Correction rejected");
});

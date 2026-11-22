import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { z } from "zod";
import { decideClaim } from "@/lib/hr/money";

const actionSchema = z.object({ action: z.enum(["approve", "reject"]), note: z.string().trim().max(500).optional().default("") });

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.approve");
  const { id } = await params;
  const { action, note } = actionSchema.parse(await req.json());
  const result = await decideClaim(ctx, id, action === "approve" ? "APPROVED" : "REJECTED", note);
  return ok(result, action === "approve" ? "Claim approved. It will be paid with the next payroll." : "Claim rejected");
});

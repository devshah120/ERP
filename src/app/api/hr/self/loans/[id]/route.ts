import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { withdrawAdvanceRequest } from "@/lib/hr/money";

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const { id } = await params;
  return ok(await withdrawAdvanceRequest(ctx, id), "Request withdrawn");
});

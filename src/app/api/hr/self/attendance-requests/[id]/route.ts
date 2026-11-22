import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { ok } from "@/lib/http/response";
import { withdrawCorrection } from "@/lib/hr/corrections";

/** Withdraws the employee's own pending request. */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const { id } = await params;
  return ok(await withdrawCorrection(ctx, id), "Correction request withdrawn");
});

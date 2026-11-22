import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { cancelArrear } from "@/lib/hr/arrears";

/** Cancels a pending day or DA arrear. */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const { id } = await params;
  return ok(await cancelArrear(ctx, id), "Arrear cancelled");
});

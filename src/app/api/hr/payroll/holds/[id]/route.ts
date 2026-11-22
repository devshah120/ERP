import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { unblockPayroll } from "@/lib/hr/holds";

/** Unblocks a salary hold. */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.approve");
  const { id } = await params;
  return ok(await unblockPayroll(ctx, id), "Salary released");
});

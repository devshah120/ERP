import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { deleteChange } from "@/lib/hr/history";

/** Removes a change entered by mistake (not the joining record, not in a payroll-locked month). */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employees.edit");
  const { id, changeId } = await params;
  return ok(await deleteChange(ctx, id, changeId), "Change removed");
});

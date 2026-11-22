import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, hasPermission } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/AppError";
import { previewLeave } from "@/lib/hr/leave";
import { selfEmployee } from "@/lib/hr/common";
import "@/models";

/** Working days a request would take. Self-service previews are always for the caller. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  const sp = req.nextUrl.searchParams;
  let employeeId = sp.get("employeeId") ?? "";
  if (!hasPermission(ctx, "hr-leaves.create")) {
    if (!hasPermission(ctx, "hr-self.view")) throw AppError.forbidden("Missing required permission: hr-leaves.create");
    employeeId = String((await selfEmployee(ctx))._id);
  }
  const fromDate = sp.get("fromDate") ?? "";
  const toDate = sp.get("toDate") || fromDate;
  if (!employeeId || !fromDate) return ok({ days: 0 });
  return ok(await previewLeave(ctx, { employeeId, fromDate, toDate, halfDay: sp.get("halfDay") === "true" }));
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { employeeMonthSheet, saveEmployeeMonth, monthSheetQuery, saveMonthSchema } from "@/lib/hr/attendance";

/** ?employeeId=&year=&month=: one employee's month, day by day (and the employees to choose from). */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.view");
  return ok(await employeeMonthSheet(ctx, monthSheetQuery.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Saves the changed days of one employee's month. */
export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.edit");
  const result = await saveEmployeeMonth(ctx, saveMonthSchema.parse(await req.json()));
  return okOrHeld(result, (r) => `Attendance saved for ${r.saved} day(s)`);
});

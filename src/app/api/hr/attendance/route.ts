import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { dailySheet, saveDailySheet, saveSheetSchema } from "@/lib/hr/attendance";

/** ?date=yyyy-mm-dd: everyone on the rolls that day with their attendance. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.view");
  const date = req.nextUrl.searchParams.get("date") || new Date().toISOString().slice(0, 10);
  return ok(await dailySheet(ctx, date));
});

export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.edit");
  const result = await saveDailySheet(ctx, saveSheetSchema.parse(await req.json()));
  return okOrHeld(result, (r) => `Attendance saved for ${r.saved} employee(s)`);
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { calendarAssignments, assignCalendar, assignmentListSchema, assignSchema } from "@/lib/hr/holidayCalendars";

/** Current employees with the holiday calendar each follows, and the calendars to choose from. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-holidays.view");
  requirePermission(ctx, "hr-employees.view");
  return ok(await calendarAssignments(ctx, assignmentListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Puts employees on a holiday calendar; it changes their records, so it needs both permissions. */
export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-holidays.edit");
  requirePermission(ctx, "hr-employees.edit");
  const result = await assignCalendar(ctx, assignSchema.parse(await req.json()));
  return ok(result, "Holiday calendar assigned");
});

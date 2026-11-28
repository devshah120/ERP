import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Employee, Holiday, HolidayCalendar, WORKING_STATUSES } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { employeeLabels, escapeRegex, objectId, pageQuery, type AnyDoc } from "./common";
import { holdForApproval, approvalFingerprint } from "@/lib/approvals/service";
import type { ApprovedRun } from "./attendance";

/*
 * Holiday calendars: which holidays each employee gets. Holidays on no
 * calendar apply to everyone; a calendar's own holidays apply to the
 * employees assigned to it, or, for employees with no calendar, to the
 * default calendar's. The day-by-day rules live in calendar.ts (holidaysFor).
 */

/** The calendar an employee follows: their own, or the default one (null when neither exists). */
export async function effectiveCalendarId(businessId: Types.ObjectId, emp: AnyDoc): Promise<Types.ObjectId | null> {
  if (emp.holidayCalendarId) {
    const own = await HolidayCalendar.exists({ _id: emp.holidayCalendarId, businessId, deletedAt: null, status: "ACTIVE" });
    if (own) return emp.holidayCalendarId;
  }
  const def = await HolidayCalendar.findOne({ businessId, deletedAt: null, status: "ACTIVE", isDefault: true }, { _id: 1 }).lean<AnyDoc>();
  return def?._id ?? null;
}

/** The next holidays an employee gets (everyone's plus their calendar's). */
export async function upcomingHolidaysFor(businessId: Types.ObjectId, emp: AnyDoc, from: Date, limit: number) {
  const calendarId = await effectiveCalendarId(businessId, emp);
  return Holiday.find({
    businessId,
    deletedAt: null,
    status: "ACTIVE",
    date: { $gte: from },
    calendarId: { $in: calendarId ? [null, calendarId] : [null] },
  })
    .sort({ date: 1 })
    .limit(limit)
    .lean<AnyDoc[]>();
}

/** Keeps at most one default calendar: saving one as default clears the flag on the others. */
export async function keepSingleDefault(businessId: Types.ObjectId, doc: AnyDoc) {
  if (!doc?.isDefault) return;
  await HolidayCalendar.updateMany({ businessId, _id: { $ne: doc._id }, isDefault: true }, { isDefault: false });
}

export const assignmentListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  departmentId: z.string().trim().regex(/^([a-f\d]{24})?$/i).optional(),
  /** A calendar id, "none" (no calendar of their own) or blank (everyone). */
  calendar: z.string().trim().regex(/^([a-f\d]{24}|none)?$/i).optional(),
  ...pageQuery,
});

export const assignSchema = z.object({
  employeeIds: z.array(objectId).min(1, "Choose at least one employee").max(1000),
  /** null = no calendar of their own (they follow the default). */
  calendarId: objectId.nullable(),
});

/** Current employees with the holiday calendar each one follows, plus the calendars to choose from. */
export async function calendarAssignments(ctx: AuthContext, params: z.infer<typeof assignmentListSchema>) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: [...WORKING_STATUSES] } };
  if (params.departmentId) filter.departmentId = new Types.ObjectId(params.departmentId);
  if (params.calendar === "none") filter.holidayCalendarId = null;
  else if (params.calendar) filter.holidayCalendarId = new Types.ObjectId(params.calendar);
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    filter.$or = [{ name: rx }, { employeeCode: rx }, { workLocation: rx }];
  }
  const [rows, total, calendars, counts] = await Promise.all([
    Employee.find(filter, { employeeCode: 1, name: 1, workLocation: 1, holidayCalendarId: 1 })
      .sort({ name: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean<AnyDoc[]>(),
    Employee.countDocuments(filter),
    HolidayCalendar.find({ businessId: ctx.businessId, deletedAt: null }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Employee.aggregate([
      { $match: { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: [...WORKING_STATUSES] } } },
      { $group: { _id: "$holidayCalendarId", n: { $sum: 1 } } },
    ]),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r._id));
  const headcount = new Map((counts as AnyDoc[]).map((c) => [c._id ? String(c._id) : "none", c.n as number]));
  const def = calendars.find((c) => c.isDefault && c.status === "ACTIVE");
  return {
    items: rows.map((e) => ({
      id: String(e._id),
      employeeCode: e.employeeCode as string,
      name: e.name as string,
      department: labels.get(String(e._id))?.department ?? "",
      location: (e.workLocation as string) ?? "",
      calendarId: e.holidayCalendarId ? String(e.holidayCalendarId) : null,
    })),
    total,
    calendars: calendars.map((c) => ({
      id: String(c._id),
      code: c.code as string,
      name: c.name as string,
      isDefault: Boolean(c.isDefault),
      active: c.status === "ACTIVE",
      employees: headcount.get(String(c._id)) ?? 0,
    })),
    defaultCalendar: def ? { id: String(def._id), name: def.name as string } : null,
    withoutCalendar: headcount.get("none") ?? 0,
  };
}

/** Puts the chosen employees on a holiday calendar (or back on the default with null). */
export async function assignCalendar(ctx: AuthContext, input: z.infer<typeof assignSchema>, opts: ApprovedRun = {}) {
  const ids = [...new Set(input.employeeIds)].map((id) => new Types.ObjectId(id));
  let calendar: AnyDoc = null;
  if (input.calendarId) {
    calendar = await HolidayCalendar.findOne({ _id: input.calendarId, businessId: ctx.businessId, deletedAt: null }, { name: 1, status: 1 }).lean<AnyDoc>();
    if (!calendar) throw AppError.badRequest("That holiday calendar was not found; reload the page", "CALENDAR_NOT_FOUND");
    if (calendar.status !== "ACTIVE") throw AppError.badRequest(`The holiday calendar "${calendar.name}" is inactive`, "CALENDAR_INACTIVE");
  }
  const found = await Employee.countDocuments({ businessId: ctx.businessId, _id: { $in: ids }, deletedAt: null });
  if (found !== ids.length) throw AppError.badRequest("Some of these employees were not found; reload the page", "EMPLOYEE_NOT_FOUND");
  if (!opts.approved) {
    const names = await Employee.find({ businessId: ctx.businessId, _id: { $in: ids.slice(0, 10) } }, { name: 1, employeeCode: 1 }).lean<AnyDoc[]>();
    const held = await holdForApproval(ctx, {
      document: "hr-holiday-change",
      targetKey: `holiday-assign:${approvalFingerprint(ids.map(String).sort())}`,
      summary: `Put ${ids.length} employee(s) on ${calendar ? `the "${calendar.name}" holiday calendar` : "the default holiday calendar"}`,
      details: [
        { label: "Holiday calendar", value: calendar ? calendar.name : "Default calendar" },
        { label: "Employees", value: String(ids.length) },
        { label: "Who", value: names.map((n) => `${n.employeeCode} ${n.name}`).join(", ") + (ids.length > 10 ? ` and ${ids.length - 10} more` : "") },
      ],
      employeeId: ids.length === 1 ? ids[0] : null,
      payload: { input },
    });
    if (held) return held;
  }

  const res = await Employee.updateMany(
    { businessId: ctx.businessId, _id: { $in: ids }, deletedAt: null },
    { holidayCalendarId: calendar ? calendar._id : null, updatedBy: ctx.userId }
  );
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.employees",
    documentType: "Employee",
    newValue: { holidayCalendar: calendar ? calendar.name : "Default", employees: ids.length },
    reason: "Holiday calendar assigned",
  });
  return { updated: res.modifiedCount, calendar: calendar ? (calendar.name as string) : null };
}

import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Attendance, ATTENDANCE_STATUSES, PayrollRun, LeaveApplication } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import {
  toDay,
  dayKey,
  eachDay,
  monthRange,
  minutesOf,
  todayIn,
  nowTimeIn,
  loadCalendar,
  shiftFor,
  holidaysFor,
  dayKind,
  employeesDuring,
  type HrCalendar,
  type ShiftRule,
} from "./calendar";
import { employeeLabels, selfEmployee, businessTimeZone, objectId, type AnyDoc } from "./common";

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

/** Worked, late and overtime minutes for a day from check-in/out times and the shift. */
export function computeTimes(shift: ShiftRule, checkIn?: string, checkOut?: string) {
  const inMin = minutesOf(checkIn);
  const outMin = minutesOf(checkOut);
  const start = minutesOf(shift.startTime) ?? 0;
  const lateMinutes = inMin !== null ? Math.max(0, inMin - start - shift.graceMinutes) : 0;
  let workedMinutes = 0;
  if (inMin !== null && outMin !== null) {
    // A check-out earlier than check-in is a night shift crossing midnight.
    workedMinutes = outMin >= inMin ? outMin - inMin : outMin + 24 * 60 - inMin;
  }
  const overtimeMinutes = Math.max(0, workedMinutes - shift.fullDayHours * 60);
  return { workedMinutes, lateMinutes, overtimeMinutes };
}

/** Day status implied by hours worked: full day, half day, or absent. */
export function statusFromHours(shift: ShiftRule, workedMinutes: number): "PRESENT" | "HALF_DAY" | "ABSENT" {
  if (workedMinutes >= shift.fullDayHours * 60) return "PRESENT";
  if (workedMinutes >= shift.halfDayHours * 60) return "HALF_DAY";
  return "ABSENT";
}

export interface MonthSummary {
  present: number;
  absent: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  holidays: number;
  weeklyOffs: number;
  onDuty: number;
  /** Working days with nothing recorded — treated as present (paid). */
  unmarked: number;
  lateDays: number;
  /** Days before joining or after the last working day. */
  notEmployed: number;
  /** Loss-of-pay days: absences, unpaid leave, half of each unpaid half day, and days not employed. */
  lopDays: number;
}

export interface AttendanceRow {
  status: string;
  leaveApplicationId?: unknown;
  leaveIsPaid?: boolean;
  lateMinutes?: number;
}

/**
 * Classifies every day of a month for one employee and returns the day codes
 * (for the register) and the totals payroll needs. Pure — the caller loads
 * the records, so payroll and the register can never disagree.
 */
export function summarizeMonth(
  emp: { dateOfJoining: Date; dateOfExit?: Date | null; shiftId?: unknown; holidayCalendarId?: unknown },
  cal: HrCalendar,
  days: Date[],
  records: Map<string, AttendanceRow>
): { codes: string[]; summary: MonthSummary } {
  const shift = shiftFor(cal, emp.shiftId, emp.holidayCalendarId);
  const joined = toDay(emp.dateOfJoining);
  const exited = emp.dateOfExit ? toDay(emp.dateOfExit) : null;
  const s: MonthSummary = { present: 0, absent: 0, halfDays: 0, paidLeave: 0, unpaidLeave: 0, holidays: 0, weeklyOffs: 0, onDuty: 0, unmarked: 0, lateDays: 0, notEmployed: 0, lopDays: 0 };
  const codes: string[] = [];

  for (const d of days) {
    if (d < joined || (exited && d > exited)) {
      s.notEmployed += 1;
      s.lopDays += 1;
      codes.push("");
      continue;
    }
    const rec = records.get(dayKey(d));
    if (rec) {
      if ((rec.lateMinutes ?? 0) > 0) s.lateDays += 1;
      switch (rec.status) {
        case "PRESENT":
          s.present += 1;
          codes.push("P");
          break;
        case "ON_DUTY":
          s.onDuty += 1;
          codes.push("OD");
          break;
        case "ABSENT":
          s.absent += 1;
          s.lopDays += 1;
          codes.push("A");
          break;
        case "HALF_DAY":
          s.halfDays += 1;
          s.present += 0.5;
          if (rec.leaveApplicationId && rec.leaveIsPaid !== false) {
            s.paidLeave += 0.5;
          } else {
            if (rec.leaveApplicationId) s.unpaidLeave += 0.5;
            s.lopDays += 0.5;
          }
          codes.push("HD");
          break;
        case "LEAVE":
          if (rec.leaveIsPaid === false) {
            s.unpaidLeave += 1;
            s.lopDays += 1;
            codes.push("LOP");
          } else {
            s.paidLeave += 1;
            codes.push("L");
          }
          break;
        case "HOLIDAY":
          s.holidays += 1;
          codes.push("H");
          break;
        case "WEEKLY_OFF":
          s.weeklyOffs += 1;
          codes.push("WO");
          break;
        default:
          codes.push("?");
      }
      continue;
    }
    const kind = dayKind(cal, shift, d);
    if (kind === "HOLIDAY") {
      s.holidays += 1;
      codes.push("H");
    } else if (kind === "WEEKLY_OFF") {
      s.weeklyOffs += 1;
      codes.push("WO");
    } else {
      s.unmarked += 1;
      codes.push("-");
    }
  }
  return { codes, summary: s };
}

/* ------------------------------------------------------------------ */
/* Payroll lock                                                        */
/* ------------------------------------------------------------------ */

/** Attendance and leave in a month whose payroll is approved or paid are frozen. */
export async function assertPayrollOpen(businessId: Types.ObjectId, dates: Date[]): Promise<void> {
  const months = [...new Set(dates.map((d) => `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}`))].map((k) => {
    const [y, m] = k.split("-").map(Number);
    return { year: y, month: m };
  });
  if (months.length === 0) return;
  const locked = await PayrollRun.findOne({ businessId, status: { $in: ["APPROVED", "PAID"] }, $or: months }).lean<AnyDoc>();
  if (locked) {
    throw AppError.badRequest(
      `Payroll for ${locked.month}/${locked.year} is already ${String(locked.status).toLowerCase()}, so attendance and leave for that month are locked.`,
      "PAYROLL_LOCKED"
    );
  }
}

/* ------------------------------------------------------------------ */
/* Daily sheet                                                         */
/* ------------------------------------------------------------------ */

export async function dailySheet(ctx: AuthContext, dateStr: string) {
  const date = toDay(dateStr);
  const [emps, cal, records] = await Promise.all([
    employeesDuring(ctx.businessId, date, date),
    loadCalendar(ctx.businessId, date, date),
    Attendance.find({ businessId: ctx.businessId, date }).lean<AnyDoc[]>(),
  ]);
  const labels = await employeeLabels(ctx.businessId, emps.map((e) => e._id));
  const byEmp = new Map(records.map((r) => [String(r.employeeId), r]));
  const locked = await PayrollRun.exists({ businessId: ctx.businessId, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, status: { $in: ["APPROVED", "PAID"] } });

  const rows = emps.map((e) => {
    const shift = shiftFor(cal, e.shiftId, e.holidayCalendarId);
    const kind = dayKind(cal, shift, date);
    const rec = byEmp.get(String(e._id));
    const label = labels.get(String(e._id));
    return {
      employeeId: String(e._id),
      employeeCode: e.employeeCode,
      name: e.name,
      department: label?.department ?? "",
      designation: label?.designation ?? "",
      shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime },
      dayKind: kind,
      suggested: kind === "HOLIDAY" ? "HOLIDAY" : kind === "WEEKLY_OFF" ? "WEEKLY_OFF" : "PRESENT",
      record: rec
        ? {
            status: rec.status,
            checkIn: rec.checkIn ?? "",
            checkOut: rec.checkOut ?? "",
            workedMinutes: rec.workedMinutes ?? 0,
            lateMinutes: rec.lateMinutes ?? 0,
            notes: rec.notes ?? "",
            source: rec.source,
            fromLeave: Boolean(rec.leaveApplicationId),
          }
        : null,
    };
  });

  const counts: Record<string, number> = {};
  for (const r of rows) if (r.record) counts[r.record.status] = (counts[r.record.status] ?? 0) + 1;

  return {
    date: dayKey(date),
    // The holiday most people have that day (everyone's or the default calendar's); rows carry each person's own day kind.
    holiday: holidaysFor(cal).get(dayKey(date)) ?? null,
    locked: Boolean(locked),
    rows,
    counts,
    unmarked: rows.filter((r) => !r.record).length,
  };
}

export const saveSheetSchema = z.object({
  date: z.string().trim().min(1, "Choose a date"),
  rows: z
    .array(
      z.object({
        employeeId: objectId,
        status: z.enum(ATTENDANCE_STATUSES),
        checkIn: z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Use HH:mm").optional().default(""),
        checkOut: z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Use HH:mm").optional().default(""),
        notes: z.string().trim().max(300).optional().default(""),
      })
    )
    .min(1, "Nothing to save")
    .max(2000),
});

/**
 * Saves a day's attendance for many employees at once (upsert per employee).
 * Days created by an approved leave are left alone — cancel the leave to
 * change them — and a month with approved payroll is locked.
 */
export async function saveDailySheet(ctx: AuthContext, input: z.infer<typeof saveSheetSchema>) {
  const date = toDay(input.date);
  await assertPayrollOpen(ctx.businessId, [date]);

  const ids = input.rows.map((r) => new Types.ObjectId(r.employeeId));
  const [emps, cal, existing] = await Promise.all([
    employeesDuring(ctx.businessId, date, date),
    loadCalendar(ctx.businessId, date, date),
    Attendance.find({ businessId: ctx.businessId, date, employeeId: { $in: ids } }).lean<AnyDoc[]>(),
  ]);
  const empMap = new Map(emps.map((e) => [String(e._id), e]));
  const leaveDays = new Set(existing.filter((r) => r.leaveApplicationId).map((r) => String(r.employeeId)));

  let saved = 0;
  let skipped = 0;
  const ops = [];
  for (const row of input.rows) {
    const emp = empMap.get(row.employeeId);
    if (!emp) throw AppError.badRequest("One of the employees is not on the rolls on this date", "EMPLOYEE_NOT_EMPLOYED");
    if (leaveDays.has(row.employeeId)) {
      skipped += 1;
      continue;
    }
    const shift = shiftFor(cal, emp.shiftId, emp.holidayCalendarId);
    const working = row.status === "PRESENT" || row.status === "HALF_DAY" || row.status === "ON_DUTY";
    const times = working ? computeTimes(shift, row.checkIn, row.checkOut) : { workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 };
    ops.push({
      updateOne: {
        filter: { businessId: ctx.businessId, employeeId: emp._id, date },
        update: {
          $set: {
            status: row.status,
            checkIn: working ? row.checkIn : "",
            checkOut: working ? row.checkOut : "",
            ...times,
            source: "MANUAL",
            leaveApplicationId: null,
            leaveIsPaid: true,
            notes: row.notes,
            updatedBy: ctx.userId,
          },
          $setOnInsert: { createdBy: ctx.userId },
        },
        upsert: true,
      },
    });
    saved += 1;
  }
  if (ops.length > 0) await Attendance.bulkWrite(ops);

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.attendance",
    documentType: "Attendance",
    newValue: { date: dayKey(date), saved, skipped },
  });

  return { date: dayKey(date), saved, skipped };
}

/* ------------------------------------------------------------------ */
/* Monthly register                                                    */
/* ------------------------------------------------------------------ */

export async function monthlyRegister(ctx: AuthContext, year: number, month: number, filter: { employeeId?: string; departmentId?: string } = {}) {
  const { start, end } = monthRange(year, month);
  const days = eachDay(start, end);
  let emps = await employeesDuring(ctx.businessId, start, end);
  if (filter.employeeId) emps = emps.filter((e) => String(e._id) === filter.employeeId);
  if (filter.departmentId) emps = emps.filter((e) => String(e.departmentId ?? "") === filter.departmentId);

  const [cal, records, labels] = await Promise.all([
    loadCalendar(ctx.businessId, start, end),
    Attendance.find({ businessId: ctx.businessId, date: { $gte: start, $lte: end }, employeeId: { $in: emps.map((e) => e._id) } }).lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, emps.map((e) => e._id)),
  ]);
  const byEmp = new Map<string, Map<string, AnyDoc>>();
  for (const r of records) {
    const k = String(r.employeeId);
    if (!byEmp.has(k)) byEmp.set(k, new Map());
    byEmp.get(k)!.set(dayKey(toDay(r.date)), r);
  }

  const rows = emps.map((e) => {
    const { codes, summary } = summarizeMonth(e, cal, days, byEmp.get(String(e._id)) ?? new Map());
    const label = labels.get(String(e._id));
    return {
      employeeId: String(e._id),
      employeeCode: e.employeeCode,
      name: e.name,
      department: label?.department ?? "",
      codes,
      summary,
      payableDays: days.length - summary.lopDays,
    };
  });

  return {
    year,
    month,
    days: days.map((d) => ({ date: dayKey(d), day: d.getUTCDate(), weekday: d.getUTCDay(), holiday: holidaysFor(cal).get(dayKey(d)) ?? null })),
    rows,
  };
}

/* ------------------------------------------------------------------ */
/* Self-service punch                                                  */
/* ------------------------------------------------------------------ */

/** Check in (first punch of the day) or check out (second), in the business's time zone. */
export async function punch(ctx: AuthContext) {
  const emp = await selfEmployee(ctx);
  const tz = await businessTimeZone(ctx.businessId);
  const date = todayIn(tz);
  const now = nowTimeIn(tz);
  await assertPayrollOpen(ctx.businessId, [date]);

  const cal = await loadCalendar(ctx.businessId, date, date);
  const shift = shiftFor(cal, emp.shiftId, emp.holidayCalendarId);
  const rec = await Attendance.findOne({ businessId: ctx.businessId, employeeId: emp._id, date });

  if (rec?.leaveApplicationId && rec.status === "LEAVE") {
    throw AppError.badRequest("You are on approved leave today.", "ON_LEAVE");
  }

  if (!rec || !rec.checkIn) {
    const times = computeTimes(shift, now, "");
    await Attendance.updateOne(
      { businessId: ctx.businessId, employeeId: emp._id, date },
      {
        $set: { status: rec?.status === "HALF_DAY" ? "HALF_DAY" : "PRESENT", checkIn: now, checkOut: "", ...times, source: "SELF", updatedBy: ctx.userId },
        $setOnInsert: { createdBy: ctx.userId, leaveApplicationId: null, leaveIsPaid: true, notes: "" },
      },
      { upsert: true }
    );
    return { action: "CHECK_IN" as const, time: now, date: dayKey(date), lateMinutes: times.lateMinutes };
  }

  if (rec.checkOut) throw AppError.badRequest(`You already checked out at ${rec.checkOut} today.`, "ALREADY_CHECKED_OUT");

  const times = computeTimes(shift, rec.checkIn, now);
  // A half-day leave keeps its status; otherwise the hours decide.
  const status = rec.leaveApplicationId ? rec.status : statusFromHours(shift, times.workedMinutes);
  rec.set({ checkOut: now, ...times, status, updatedBy: ctx.userId });
  await rec.save();
  return { action: "CHECK_OUT" as const, time: now, date: dayKey(date), workedMinutes: times.workedMinutes, status };
}

/** Today's punch state plus the month so far, for the self-service screen. */
export async function myAttendance(ctx: AuthContext, year: number, month: number) {
  const emp = await selfEmployee(ctx);
  const tz = await businessTimeZone(ctx.businessId);
  const today = todayIn(tz);
  const { start, end } = monthRange(year, month);
  const days = eachDay(start, end);
  const [cal, records, pendingLeaves] = await Promise.all([
    loadCalendar(ctx.businessId, start, end),
    Attendance.find({ businessId: ctx.businessId, employeeId: emp._id, date: { $gte: start, $lte: end } }).lean<AnyDoc[]>(),
    LeaveApplication.countDocuments({ businessId: ctx.businessId, employeeId: emp._id, status: "PENDING" }),
  ]);
  const map = new Map(records.map((r) => [dayKey(toDay(r.date)), r]));
  const { codes, summary } = summarizeMonth(emp, cal, days, map);
  const todayRec = await Attendance.findOne({ businessId: ctx.businessId, employeeId: emp._id, date: today }).lean<AnyDoc>();
  const shift = shiftFor(cal, emp.shiftId, emp.holidayCalendarId);
  return {
    today: {
      date: dayKey(today),
      checkIn: todayRec?.checkIn ?? "",
      checkOut: todayRec?.checkOut ?? "",
      status: todayRec?.status ?? null,
      shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime },
    },
    days: days.map((d, i) => ({
      date: dayKey(d),
      day: d.getUTCDate(),
      weekday: d.getUTCDay(),
      code: codes[i],
      checkIn: map.get(dayKey(d))?.checkIn ?? "",
      checkOut: map.get(dayKey(d))?.checkOut ?? "",
      holiday: shift.holidays?.get(dayKey(d)) ?? null,
    })),
    summary,
    pendingLeaves,
  };
}

import type { Types } from "mongoose";
import { Holiday, Shift, Employee, WEEKDAYS, WORKING_STATUSES } from "@/models/hr";
import { AppError } from "@/lib/errors/AppError";

/**
 * Calendar days in HR are stored as UTC midnight of the date, so "2026-11-22"
 * is the same instant whatever the server's time zone. Every date the HR
 * services accept or return goes through these helpers.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-22" (or any parseable date) → UTC midnight of that calendar day. */
export function toDay(value: string | Date): Date {
  if (value instanceof Date) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw AppError.badRequest("Enter a valid date", "BAD_DATE");
    return toDay(d);
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** UTC midnight → "2026-11-22". */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}

/** Every calendar day from `from` to `to`, inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let d = toDay(from); d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function monthRange(year: number, month: number): { start: Date; end: Date; days: number } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return { start, end, days: end.getUTCDate() };
}

export function weekdayName(d: Date): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[d.getUTCDay()];
}

/** "09:30" → 570. Blank or malformed → null. */
export function minutesOf(time: string | undefined | null): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time ?? "").trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Today's calendar day in the business's time zone (India by default). */
export function todayIn(timeZone = "Asia/Kolkata"): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return toDay(parts);
}

/** Current "HH:mm" in the business's time zone. */
export function nowTimeIn(timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

export interface ShiftRule {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  halfDayHours: number;
  fullDayHours: number;
  weeklyOffs: string[];
}

const FALLBACK_SHIFT: ShiftRule = {
  id: "",
  name: "General",
  startTime: "09:30",
  endTime: "18:30",
  graceMinutes: 15,
  halfDayHours: 4,
  fullDayHours: 8,
  weeklyOffs: ["SUNDAY"],
};

/**
 * Everything needed to classify days for a date range: holidays by day and
 * each shift's rules, plus the shift an employee without one falls back to.
 */
export interface HrCalendar {
  holidays: Map<string, string>;
  shifts: Map<string, ShiftRule>;
  defaultShift: ShiftRule;
}

export async function loadCalendar(businessId: Types.ObjectId, from: Date, to: Date): Promise<HrCalendar> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = any;
  const [holidayRows, shiftRows] = await Promise.all([
    Holiday.find({ businessId, deletedAt: null, status: "ACTIVE", holidayType: { $ne: "OPTIONAL" }, date: { $gte: from, $lte: to } }).lean<Row[]>(),
    Shift.find({ businessId, deletedAt: null }).lean<Row[]>(),
  ]);
  const holidays = new Map<string, string>(holidayRows.map((h) => [dayKey(toDay(h.date)), h.name]));
  const shifts = new Map<string, ShiftRule>();
  for (const s of shiftRows) {
    shifts.set(String(s._id), {
      id: String(s._id),
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      graceMinutes: s.graceMinutes ?? 0,
      halfDayHours: s.halfDayHours ?? 4,
      fullDayHours: s.fullDayHours ?? 8,
      weeklyOffs: [s.weeklyOff1, s.weeklyOff2].filter(Boolean),
    });
  }
  const def = shiftRows.find((s) => s.isDefault && s.status === "ACTIVE") ?? shiftRows.find((s) => s.status === "ACTIVE");
  return { holidays, shifts, defaultShift: (def && shifts.get(String(def._id))) || FALLBACK_SHIFT };
}

export function shiftFor(cal: HrCalendar, shiftId: unknown): ShiftRule {
  const own = shiftId ? cal.shifts.get(String(shiftId)) : undefined;
  return own ?? cal.defaultShift;
}

export type DayKind = "WORKING" | "WEEKLY_OFF" | "HOLIDAY";

export function dayKind(cal: HrCalendar, shift: ShiftRule, d: Date): DayKind {
  if (cal.holidays.has(dayKey(d))) return "HOLIDAY";
  if (shift.weeklyOffs.includes(weekdayName(d))) return "WEEKLY_OFF";
  return "WORKING";
}

/** Working days between two dates for a shift — what a leave application consumes. */
export function workingDays(cal: HrCalendar, shift: ShiftRule, from: Date, to: Date): Date[] {
  return eachDay(from, to).filter((d) => dayKind(cal, shift, d) === "WORKING");
}

/**
 * Employees on the rolls at any point in [from, to]: joined by the end of the
 * range, not exited before its start, and not soft-deleted.
 */
export function employedDuringFilter(businessId: Types.ObjectId, from: Date, to: Date) {
  return {
    businessId,
    deletedAt: null,
    dateOfJoining: { $lte: to },
    $or: [
      { dateOfExit: null, employmentStatus: { $in: WORKING_STATUSES } },
      { dateOfExit: { $gte: from } },
    ],
  };
}

export async function employeesDuring(businessId: Types.ObjectId, from: Date, to: Date) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Employee.find(employedDuringFilter(businessId, from, to)).sort({ employeeCode: 1 }).lean<any[]>();
}

import { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { Attendance, IncentiveMatrix, PayComponent, PayrollRun, PayrollVariable } from "@/models/hr";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, eachDay, monthRange, loadCalendar, employeesDuring, dayKind, shiftFor } from "./calendar";
import { summarizeMonth, type AttendanceRow, type MonthSummary } from "./attendance";
import { salaryForMonth } from "./history";
import { employeeLabels, type AnyDoc } from "./common";
import { monthLabel } from "./payroll";

/*
 * Attendance incentive ("incentive matrix"): each employee's year of
 * attendance is counted (working days, holidays, weekly offs, present,
 * leave, absent), the matrix's slab for their days present gives a number of
 * days' salary, and that amount is added to the payout month's payroll
 * (January by default) as variable pay under the ATT_INC component.
 */

export const INCENTIVE_COMPONENT = { code: "ATT_INC", name: "Attendance incentive", kind: "EARNING", esiApplicable: false, description: "Paid from the attendance incentive matrix." } as const;

const ZERO = new Decimal(0);
const d = (v: unknown) => new Decimal(v === null || v === undefined || v === "" ? "0" : String(v));

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

export interface MatrixRules {
  period: string;
  basis: string;
  slabs: { minValue: number; incentiveDays: number }[];
  countOnDuty: boolean;
  countUnmarked: boolean;
  countPaidLeave: boolean;
  salaryBasis: string;
  dayDivisor: number;
  payoutMonth: number;
}

/** The days a matrix covers for a year, and the payroll month that pays it (the first payout month after the period ends). */
export function incentivePeriod(m: Pick<MatrixRules, "period" | "payoutMonth">, year: number) {
  const fy = m.period === "FINANCIAL_YEAR";
  const start = new Date(Date.UTC(year, fy ? 3 : 0, 1));
  const end = fy ? new Date(Date.UTC(year + 1, 2, 31)) : new Date(Date.UTC(year, 11, 31));
  const endYear = end.getUTCFullYear();
  const endMonth = end.getUTCMonth() + 1;
  const payoutMonth = m.payoutMonth || 1;
  const payoutYear = payoutMonth > endMonth ? endYear : endYear + 1;
  return { start, end, label: fy ? `FY ${year}-${String((year + 1) % 100).padStart(2, "0")}` : String(year), payoutYear, payoutMonth };
}

/** Days that count as present under the matrix (a half day counts half; holidays and weekly offs never count). */
export function eligibleDays(s: MonthSummary, m: Pick<MatrixRules, "countOnDuty" | "countUnmarked" | "countPaidLeave">): number {
  let total = new Decimal(s.present);
  if (m.countOnDuty) total = total.plus(s.onDuty);
  if (m.countUnmarked) total = total.plus(s.unmarked);
  if (m.countPaidLeave) total = total.plus(s.paidLeave);
  return total.toNumber();
}

/** The incentive days of the highest slab reached; 0 below the lowest. */
export function incentiveDaysFor(slabs: { minValue: number; incentiveDays: number }[], value: number): { incentiveDays: number; slab: number | null } {
  let best: { minValue: number; incentiveDays: number } | null = null;
  for (const s of slabs) if (value >= s.minValue && (!best || s.minValue > best.minValue)) best = s;
  return best ? { incentiveDays: best.incentiveDays, slab: best.minValue } : { incentiveDays: 0, slab: null };
}

/** One day's salary: the monthly gross (or basic) ÷ the divisor, to the paisa. */
export function dayRate(monthly: Decimal, divisor: number): Decimal {
  return divisor > 0 ? monthly.dividedBy(divisor).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) : ZERO;
}

/* ------------------------------------------------------------------ */
/* Year of attendance per employee                                     */
/* ------------------------------------------------------------------ */

export interface YearAttendanceRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string;
  dateOfJoining: string;
  dateOfExit: string | null;
  calendarDays: number;
  daysEmployed: number;
  weeklyOffs: number;
  holidays: number;
  workingDays: number;
  present: number;
  halfDays: number;
  onDuty: number;
  unmarked: number;
  paidLeave: number;
  unpaidLeave: number;
  absent: number;
  lopDays: number;
  summary: MonthSummary;
}

/**
 * Every employee on the rolls at any time in [start, end] with their days
 * classified exactly as payroll classifies them (summarizeMonth over the
 * whole range). Working days = days employed − weekly offs − holidays.
 */
export async function yearAttendance(ctx: AuthContext, start: Date, end: Date, filter: { departmentId?: string } = {}) {
  let emps = await employeesDuring(ctx.businessId, start, end);
  if (filter.departmentId) emps = emps.filter((e) => String(e.departmentId ?? "") === filter.departmentId);
  const days = eachDay(start, end);
  const [cal, records, labels] = await Promise.all([
    loadCalendar(ctx.businessId, start, end),
    Attendance.find(
      { businessId: ctx.businessId, date: { $gte: start, $lte: end }, employeeId: { $in: emps.map((e) => e._id) } },
      { employeeId: 1, date: 1, status: 1, leaveApplicationId: 1, leaveIsPaid: 1, lateMinutes: 1 }
    ).lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, emps.map((e) => e._id)),
  ]);
  const byEmp = new Map<string, Map<string, AttendanceRow>>();
  for (const r of records) {
    const k = String(r.employeeId);
    if (!byEmp.has(k)) byEmp.set(k, new Map());
    byEmp.get(k)!.set(dayKey(toDay(r.date)), r);
  }
  const rows: YearAttendanceRow[] = emps.map((e) => {
    const { summary: s } = summarizeMonth(e, cal, days, byEmp.get(String(e._id)) ?? new Map());
    const daysEmployed = days.length - s.notEmployed;
    return {
      employeeId: String(e._id),
      employeeCode: e.employeeCode,
      name: e.name,
      department: labels.get(String(e._id))?.department ?? "",
      dateOfJoining: dayKey(toDay(e.dateOfJoining)),
      dateOfExit: e.dateOfExit ? dayKey(toDay(e.dateOfExit)) : null,
      calendarDays: days.length,
      daysEmployed,
      weeklyOffs: s.weeklyOffs,
      holidays: s.holidays,
      workingDays: daysEmployed - s.weeklyOffs - s.holidays,
      present: s.present,
      halfDays: s.halfDays,
      onDuty: s.onDuty,
      unmarked: s.unmarked,
      paidLeave: s.paidLeave,
      unpaidLeave: s.unpaidLeave,
      absent: s.absent,
      // Days not employed are loss of pay for payroll, but not absences from work.
      lopDays: new Decimal(s.lopDays).minus(s.notEmployed).toNumber(),
      summary: s,
    };
  });
  return { rows, emps };
}

/* ------------------------------------------------------------------ */
/* Incentive                                                           */
/* ------------------------------------------------------------------ */

export const incentiveQuery = z.object({
  matrixId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Choose an incentive matrix"),
  year: z.coerce.number().int().min(2000).max(2100),
  departmentId: z.string().trim().regex(/^([a-f\d]{24})?$/i).optional(),
});

async function loadMatrix(ctx: AuthContext, id: string): Promise<AnyDoc> {
  const m = await IncentiveMatrix.findOne({ _id: id, businessId: ctx.businessId, deletedAt: null }).lean<AnyDoc>();
  if (!m) throw AppError.notFound("Incentive matrix not found");
  return m;
}

/** The component the incentive is paid under, created the first time it is needed. */
async function incentiveComponent(businessId: Types.ObjectId, create: boolean): Promise<AnyDoc | null> {
  const found = await PayComponent.findOne({ businessId, code: INCENTIVE_COMPONENT.code, deletedAt: null }).lean<AnyDoc>();
  if (found || !create) return found;
  const [made] = await PayComponent.create([{ businessId, ...INCENTIVE_COMPONENT }]);
  return made.toObject();
}

export type IncentiveStatus = "PAYABLE" | "BELOW_SLAB" | "LEFT";

/** Each employee's year, the slab reached, the incentive and whether it is already in the payout month's variable pay. */
export async function attendanceIncentive(ctx: AuthContext, q: z.infer<typeof incentiveQuery>) {
  const m = await loadMatrix(ctx, q.matrixId);
  const rules = m as MatrixRules;
  const p = incentivePeriod(rules, q.year);
  const payout = monthRange(p.payoutYear, p.payoutMonth);
  const lastMonth = monthRange(p.end.getUTCFullYear(), p.end.getUTCMonth() + 1);

  const { rows: year, emps } = await yearAttendance(ctx, p.start, p.end, { departmentId: q.departmentId || undefined });
  const [salaries, onRolls, component, run] = await Promise.all([
    salaryForMonth(ctx.businessId, emps, lastMonth.start, lastMonth.end),
    employeesDuring(ctx.businessId, payout.start, payout.end),
    incentiveComponent(ctx.businessId, false),
    PayrollRun.findOne({ businessId: ctx.businessId, year: p.payoutYear, month: p.payoutMonth, status: { $ne: "CANCELLED" } }, { status: 1, runNumber: 1 }).lean<AnyDoc>(),
  ]);
  const payable = new Set(onRolls.map((e) => String(e._id)));
  const posted = component
    ? await PayrollVariable.find({ businessId: ctx.businessId, year: p.payoutYear, month: p.payoutMonth, componentId: component._id }, { employeeId: 1, amount: 1 }).lean<AnyDoc[]>()
    : [];
  const postedBy = new Map(posted.map((v) => [String(v.employeeId), d(v.amount).toFixed(2)]));
  const slabs = [...(rules.slabs ?? [])].sort((a, b) => a.minValue - b.minValue);

  let total = ZERO;
  const rows = year.map((y) => {
    const eligible = eligibleDays(y.summary, rules);
    const value = rules.basis === "PERCENT" ? (y.daysEmployed > 0 ? new Decimal(eligible).times(100).dividedBy(y.daysEmployed).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber() : 0) : eligible;
    const { incentiveDays, slab } = incentiveDaysFor(slabs, value);
    const s = salaries.get(y.employeeId);
    const monthly = s ? (rules.salaryBasis === "BASIC" ? s.basic : s.basic.plus(s.hra).plus(s.conveyance).plus(s.specialAllowance).plus(s.otherAllowance)) : ZERO;
    const rate = dayRate(monthly, rules.dayDivisor || 30);
    const amount = rate.times(incentiveDays).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const status: IncentiveStatus = !payable.has(y.employeeId) ? "LEFT" : incentiveDays > 0 ? "PAYABLE" : "BELOW_SLAB";
    if (status === "PAYABLE") total = total.plus(amount);
    const { summary, ...rest } = y;
    return {
      ...rest,
      lateDays: summary.lateDays,
      eligibleDays: eligible,
      percent: y.daysEmployed > 0 ? new Decimal(eligible).times(100).dividedBy(y.daysEmployed).toFixed(1) : "0.0",
      slab,
      incentiveDays,
      monthlySalary: monthly.toFixed(2),
      dayRate: rate.toFixed(2),
      amount: status === "PAYABLE" ? amount.toFixed(2) : "0.00",
      status,
      posted: postedBy.get(y.employeeId) ?? null,
    };
  });

  return {
    matrix: { id: String(m._id), code: m.code as string, name: m.name as string, basis: rules.basis, salaryBasis: rules.salaryBasis, dayDivisor: rules.dayDivisor, slabs },
    period: { label: p.label, start: dayKey(p.start), end: dayKey(p.end) },
    payout: { year: p.payoutYear, month: p.payoutMonth, label: monthLabel(p.payoutMonth, p.payoutYear), payroll: run ? { runNumber: run.runNumber as string, status: run.status as string } : null },
    rows,
    totals: {
      employees: rows.length,
      payable: rows.filter((r) => r.status === "PAYABLE").length,
      amount: total.toFixed(2),
      posted: posted.reduce((t, v) => t.plus(d(v.amount)), ZERO).toFixed(2),
    },
  };
}

/**
 * Adds the incentive to the payout month's payroll as variable pay: one
 * ATT_INC amount per eligible employee, replacing what was posted before
 * (an employee no longer due one has theirs removed). Refused once that
 * month's payroll is approved; a draft must be regenerated to include it.
 */
export async function postIncentive(ctx: AuthContext, q: z.infer<typeof incentiveQuery>) {
  const result = await attendanceIncentive(ctx, q);
  const { payout } = result;
  if (payout.payroll && payout.payroll.status !== "DRAFT") {
    throw AppError.badRequest(`${payout.label} payroll (${payout.payroll.runNumber}) is already ${payout.payroll.status.toLowerCase()}, so its variable pay is locked.`, "PAYROLL_LOCKED");
  }
  const component = await incentiveComponent(ctx.businessId, true);
  const ops: AnyDoc[] = [];
  let added = 0;
  let removed = 0;
  for (const r of result.rows) {
    const filter = { businessId: ctx.businessId, year: payout.year, month: payout.month, employeeId: new Types.ObjectId(r.employeeId), componentId: component!._id };
    if (r.status === "PAYABLE" && new Decimal(r.amount).gt(0)) {
      ops.push({
        updateOne: {
          filter,
          update: { $set: { amount: toDecimal128(new Decimal(r.amount)), note: `${result.matrix.name} ${result.period.label}: ${r.incentiveDays} day(s)`, updatedBy: ctx.userId }, $setOnInsert: { createdBy: ctx.userId } },
          upsert: true,
        },
      });
      added += 1;
    } else if (r.posted) {
      ops.push({ deleteOne: { filter } });
      removed += 1;
    }
  }
  if (ops.length > 0) await PayrollVariable.bulkWrite(ops);
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.payroll",
    documentType: "PayrollVariable",
    newValue: { incentive: result.matrix.name, period: result.period.label, payout: payout.label, employees: added, removed, amount: result.totals.amount },
    reason: "Attendance incentive added to payroll",
  });
  return { added, removed, amount: result.totals.amount, payout: payout.label, draftPayroll: payout.payroll?.status === "DRAFT" ? payout.payroll.runNumber : null };
}

/* ------------------------------------------------------------------ */
/* Worked on a weekly off or holiday                                   */
/* ------------------------------------------------------------------ */

const WORKED = new Set(["PRESENT", "HALF_DAY", "ON_DUTY"]);

/** The days of a period: a calendar year (January–December) or a financial year (April–March) starting in `year`. */
export function reportPeriod(year: number, financial: boolean) {
  return financial
    ? { start: new Date(Date.UTC(year, 3, 1)), end: new Date(Date.UTC(year + 1, 2, 31)), label: `FY ${year}-${String((year + 1) % 100).padStart(2, "0")}` }
    : { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)), label: String(year) };
}

/**
 * Employees marked present (or half day / on duty) on a day that was their
 * own weekly off or holiday, with the dates. Each person's shift and holiday
 * calendar decide which days were off for them.
 */
export async function restDayWorking(ctx: AuthContext, start: Date, end: Date) {
  const emps = await employeesDuring(ctx.businessId, start, end);
  const [cal, records, labels] = await Promise.all([
    loadCalendar(ctx.businessId, start, end),
    Attendance.find(
      { businessId: ctx.businessId, date: { $gte: start, $lte: end }, employeeId: { $in: emps.map((e) => e._id) }, status: { $in: [...WORKED] } },
      { employeeId: 1, date: 1, status: 1, workedMinutes: 1 }
    )
      .sort({ date: 1 })
      .lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, emps.map((e) => e._id)),
  ]);
  const empBy = new Map(emps.map((e) => [String(e._id), e]));
  const out = new Map<string, { weeklyOffs: string[]; holidays: string[]; minutes: number; days: number }>();
  for (const r of records) {
    const e = empBy.get(String(r.employeeId));
    if (!e) continue;
    const kind = dayKind(cal, shiftFor(cal, e.shiftId, e.holidayCalendarId), toDay(r.date));
    if (kind === "WORKING") continue;
    const k = String(e._id);
    const acc = out.get(k) ?? { weeklyOffs: [], holidays: [], minutes: 0, days: 0 };
    (kind === "HOLIDAY" ? acc.holidays : acc.weeklyOffs).push(dayKey(toDay(r.date)));
    acc.days += r.status === "HALF_DAY" ? 0.5 : 1;
    acc.minutes += Number(r.workedMinutes ?? 0);
    out.set(k, acc);
  }
  const fmt = (keys: string[]) => keys.map((k) => new Date(`${k}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })).join(", ");
  return [...out.entries()]
    .map(([id, a]) => {
      const e = empBy.get(id);
      return {
        employeeCode: e.employeeCode as string,
        name: e.name as string,
        department: labels.get(id)?.department ?? "",
        weeklyOffsWorked: a.weeklyOffs.length,
        holidaysWorked: a.holidays.length,
        daysWorked: a.days,
        hoursWorked: new Decimal(a.minutes).dividedBy(60).toFixed(2),
        weeklyOffDates: fmt(a.weeklyOffs),
        holidayDates: fmt(a.holidays),
      };
    })
    .sort((x, y) => y.daysWorked - x.daysWorked || x.employeeCode.localeCompare(y.employeeCode));
}

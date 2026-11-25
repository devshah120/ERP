import { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { recordAudit } from "@/lib/services/auditService";
import { Employee, Shift } from "@/models/hr";
import { Contractor, ContractWorker, ContractAttendance, CONTRACT_ATTENDANCE_STATUSES } from "@/models/contractLabour";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, monthRange, minutesOf, loadCalendar, shiftFor, dayKind, holidaysFor, type HrCalendar, type ShiftRule } from "./calendar";
import { computeTimes } from "./attendance";
import { toForest } from "./orgTree";
import { objectId, type AnyDoc } from "./common";

/*
 * Contract labour: contractors (and their sub-contractors), the workers they
 * supply, each worker's day booked to one of their contractors, and overtime
 * worked out from the day's times against the worker's shift.
 */

const ZERO = new Decimal(0);
const dec = (v: unknown) => {
  if (v === null || v === undefined || v === "") return ZERO;
  try {
    return new Decimal(String(v));
  } catch {
    return ZERO;
  }
};

/* ------------------------------------------------------------------ */
/* Master checks                                                       */
/* ------------------------------------------------------------------ */

/**
 * A contractor's parent must be a live contractor of the business, and not
 * the contractor itself or anyone under it (which would make a loop).
 */
export async function assertContractorParent(businessId: Types.ObjectId, parentId: unknown, selfId?: unknown): Promise<void> {
  const parent = parentId ? String(parentId) : "";
  if (!parent) return;
  if (!Types.ObjectId.isValid(parent)) throw AppError.badRequest("Choose a valid parent contractor", "BAD_PARENT_CONTRACTOR");
  const self = selfId ? String(selfId) : "";
  if (parent === self) throw AppError.badRequest("A contractor can't work under itself", "CONTRACTOR_LOOP");

  const all = await Contractor.find({ businessId, deletedAt: null }, { parentContractorId: 1 }).lean<AnyDoc[]>();
  const parentOf = new Map(all.map((c) => [String(c._id), c.parentContractorId ? String(c.parentContractorId) : null]));
  if (!parentOf.has(parent)) throw AppError.badRequest("The parent contractor was not found", "BAD_PARENT_CONTRACTOR");
  if (!self) return;
  const seen = new Set<string>();
  for (let cur: string | null = parent; cur && !seen.has(cur); cur = parentOf.get(cur) ?? null) {
    if (cur === self) throw AppError.badRequest("That contractor works under this one, so it can't also be its parent", "CONTRACTOR_LOOP");
    seen.add(cur);
  }
}

/** Every contractor picked for a worker must be a live contractor of the business. */
export async function assertWorkerContractors(businessId: Types.ObjectId, ids: unknown): Promise<void> {
  if (!Array.isArray(ids)) return;
  const unique = [...new Set(ids.map(String))];
  if (unique.some((id) => !Types.ObjectId.isValid(id))) throw AppError.badRequest("Choose valid contractors", "BAD_CONTRACTOR");
  const found = await Contractor.countDocuments({ businessId, deletedAt: null, _id: { $in: unique } });
  if (found !== unique.length) throw AppError.badRequest("One of the chosen contractors was not found", "BAD_CONTRACTOR");
}

/* ------------------------------------------------------------------ */
/* Pure rules                                                          */
/* ------------------------------------------------------------------ */

/** Length of the shift from its start to its end time (a night shift runs past midnight). */
export function shiftLengthMinutes(shift: Pick<ShiftRule, "startTime" | "endTime" | "fullDayHours">): number {
  const start = minutesOf(shift.startTime);
  const end = minutesOf(shift.endTime);
  if (start === null || end === null || start === end) return shift.fullDayHours * 60;
  return end > start ? end - start : end + 24 * 60 - start;
}

/**
 * Overtime of a day: time worked beyond the shift's length (09:30–18:30 is
 * 9 hours, so out at 19:00 after in at 09:30 is 30 minutes). Overtime below
 * the contractor's minimum is not counted. Always worked out, never typed in.
 */
export function dayOvertimeMinutes(shift: ShiftRule, checkIn: string, checkOut: string, minOvertimeMinutes = 0) {
  const { workedMinutes } = computeTimes(shift, checkIn, checkOut);
  const over = Math.max(0, workedMinutes - shiftLengthMinutes(shift));
  return { workedMinutes, overtimeMinutes: over > 0 && over >= Math.max(0, minOvertimeMinutes) ? over : 0 };
}

export interface OvertimeTerms {
  /** The worker's own hourly OT rate; 0 = use the contractor's terms. */
  workerRate: unknown;
  rateType: "MULTIPLIER" | "FIXED" | string;
  fixedRate: unknown;
  multiplier: number;
  dailyWage: unknown;
  fullDayHours: number;
}

/** Hourly overtime rate: the worker's own, else the contractor's fixed rate, else day wage ÷ full-day hours × multiplier. */
export function overtimeHourlyRate(t: OvertimeTerms): Decimal {
  const own = dec(t.workerRate);
  if (own.gt(0)) return own.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (t.rateType === "FIXED") return dec(t.fixedRate).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!(t.fullDayHours > 0)) return ZERO;
  return dec(t.dailyWage).dividedBy(t.fullDayHours).times(t.multiplier || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Pay for overtime minutes at an hourly rate, to the paisa. */
export function overtimeAmount(minutes: number, hourlyRate: Decimal): Decimal {
  return hourlyRate.times(minutes).dividedBy(60).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** "1h 30m" style hours as a 2-place decimal string, e.g. 90 → "1.50". */
export function hoursOf(minutes: number): string {
  return new Decimal(minutes).dividedBy(60).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* Contractor tree                                                     */
/* ------------------------------------------------------------------ */

export interface ContractorNode {
  id: string;
  code: string;
  name: string;
  firmName: string;
  phone: string;
  contractStatus: string;
  supervisor: string;
  workLocation: string;
  workerCount: number;
  managerId: string | null;
}

export async function contractorTree(ctx: AuthContext): Promise<{ items: ContractorNode[]; unassignedWorkers: number }> {
  const contractors = await Contractor.find(
    { businessId: ctx.businessId, deletedAt: null },
    { contractorCode: 1, name: 1, firmName: 1, phone: 1, contractStatus: 1, supervisorEmployeeId: 1, workLocation: 1, parentContractorId: 1 }
  )
    .sort({ name: 1 })
    .lean<AnyDoc[]>();
  const [counts, supervisors, unassignedWorkers] = await Promise.all([
    ContractWorker.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { businessId: ctx.businessId, deletedAt: null, status: "ACTIVE" } },
      { $unwind: "$contractorIds" },
      { $group: { _id: "$contractorIds", n: { $sum: 1 } } },
    ]),
    Employee.find({ businessId: ctx.businessId, _id: { $in: contractors.map((c) => c.supervisorEmployeeId).filter(Boolean) } }, { name: 1 }).lean<AnyDoc[]>(),
    ContractWorker.countDocuments({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", contractorIds: { $size: 0 } }),
  ]);
  const countOf = new Map(counts.map((c) => [String(c._id), c.n]));
  const sup = new Map(supervisors.map((e) => [String(e._id), e.name as string]));

  return {
    items: toForest(
      contractors.map((c) => ({
        id: String(c._id),
        code: c.contractorCode as string,
        name: c.name as string,
        firmName: (c.firmName as string) ?? "",
        phone: (c.phone as string) ?? "",
        contractStatus: (c.contractStatus as string) ?? "ACTIVE",
        supervisor: c.supervisorEmployeeId ? sup.get(String(c.supervisorEmployeeId)) ?? "" : "",
        workLocation: (c.workLocation as string) ?? "",
        workerCount: countOf.get(String(c._id)) ?? 0,
        managerId: c.parentContractorId ? String(c.parentContractorId) : null,
      }))
    ),
    unassignedWorkers,
  };
}

/** The active workers of one contractor, for the tree's side panel. */
export async function contractorWorkers(ctx: AuthContext, contractorId: string) {
  if (!Types.ObjectId.isValid(contractorId)) throw AppError.notFound("Contractor not found");
  const workers = await ContractWorker.find(
    { businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", contractorIds: new Types.ObjectId(contractorId) },
    { workerCode: 1, name: 1, phone: 1, emergencyPhone: 1, skillCategory: 1, contractorIds: 1 }
  )
    .sort({ workerCode: 1 })
    .lean<AnyDoc[]>();
  return {
    workers: workers.map((w) => ({
      id: String(w._id),
      code: w.workerCode as string,
      name: w.name as string,
      phone: (w.phone as string) ?? "",
      emergencyPhone: (w.emergencyPhone as string) ?? "",
      skillCategory: (w.skillCategory as string) ?? "",
      otherContractors: (w.contractorIds as Types.ObjectId[]).length - 1,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Daily attendance                                                    */
/* ------------------------------------------------------------------ */

/** Workers on the rolls on a day (optionally only one contractor's), with their live contractors. */
async function workersOn(ctx: AuthContext, date: Date, contractorId?: string) {
  const filter: Record<string, unknown> = {
    businessId: ctx.businessId,
    deletedAt: null,
    status: "ACTIVE",
    $and: [{ $or: [{ dateOfJoining: null }, { dateOfJoining: { $lte: date } }] }, { $or: [{ dateOfExit: null }, { dateOfExit: { $gte: date } }] }],
  };
  if (contractorId) filter.contractorIds = new Types.ObjectId(contractorId);
  const workers = await ContractWorker.find(filter).sort({ workerCode: 1 }).lean<AnyDoc[]>();
  const contractors = await Contractor.find(
    { businessId: ctx.businessId, deletedAt: null, _id: { $in: [...new Set(workers.flatMap((w) => (w.contractorIds as Types.ObjectId[]).map(String)))] } },
    { contractorCode: 1, name: 1, shiftId: 1, contractStatus: 1, minOvertimeMinutes: 1 }
  ).lean<AnyDoc[]>();
  return { workers, contractors: new Map(contractors.map((c) => [String(c._id), c])) };
}

/** The day rules for a worker: their shift, else their contractor's, else the default shift. */
function workerShift(cal: HrCalendar, worker: AnyDoc, contractor: AnyDoc | undefined): ShiftRule {
  return shiftFor(cal, worker.shiftId ?? contractor?.shiftId ?? null);
}

export async function labourSheet(ctx: AuthContext, dateStr: string, contractorId?: string) {
  const date = toDay(dateStr);
  if (contractorId && !Types.ObjectId.isValid(contractorId)) throw AppError.badRequest("Choose a valid contractor", "BAD_CONTRACTOR");
  const [{ workers, contractors }, cal] = await Promise.all([workersOn(ctx, date, contractorId), loadCalendar(ctx.businessId, date, date)]);
  const records = await ContractAttendance.find({ businessId: ctx.businessId, date, workerId: { $in: workers.map((w) => w._id) } }).lean<AnyDoc[]>();
  const byWorker = new Map(records.map((r) => [String(r.workerId), r]));

  const rows = workers
    .map((w) => {
      const options = (w.contractorIds as Types.ObjectId[]).map(String).filter((id) => contractors.has(id));
      if (options.length === 0) return null;
      const rec = byWorker.get(String(w._id));
      const defaultContractor = rec ? String(rec.contractorId) : contractorId && options.includes(contractorId) ? contractorId : options[0];
      const shift = workerShift(cal, w, contractors.get(defaultContractor));
      const kind = dayKind(cal, shift, date);
      return {
        workerId: String(w._id),
        workerCode: w.workerCode as string,
        name: w.name as string,
        phone: (w.phone as string) ?? "",
        contractors: options.map((id) => ({
          id,
          name: contractors.get(id).name as string,
          code: contractors.get(id).contractorCode as string,
          minOvertimeMinutes: Number(contractors.get(id).minOvertimeMinutes ?? 0),
        })),
        contractorId: defaultContractor,
        shift: { name: shift.name, startTime: shift.startTime, endTime: shift.endTime, lengthMinutes: shiftLengthMinutes(shift) },
        dayKind: kind,
        suggested: kind === "HOLIDAY" ? "HOLIDAY" : kind === "WEEKLY_OFF" ? "WEEKLY_OFF" : "PRESENT",
        record: rec
          ? {
              status: rec.status as string,
              checkIn: (rec.checkIn as string) ?? "",
              checkOut: (rec.checkOut as string) ?? "",
              workedMinutes: (rec.workedMinutes as number) ?? 0,
              overtimeMinutes: (rec.overtimeMinutes as number) ?? 0,
              notes: (rec.notes as string) ?? "",
            }
          : null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const counts: Record<string, number> = {};
  let overtimeMinutes = 0;
  for (const r of rows) {
    if (!r.record) continue;
    counts[r.record.status] = (counts[r.record.status] ?? 0) + 1;
    overtimeMinutes += r.record.overtimeMinutes;
  }

  return {
    date: dayKey(date),
    holiday: holidaysFor(cal).get(dayKey(date)) ?? null,
    rows,
    counts,
    overtimeMinutes,
    unmarked: rows.filter((r) => !r.record).length,
  };
}

const hhmm = z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Use HH:mm").optional().default("");
const WORKING = new Set(["PRESENT", "HALF_DAY"]);

export const saveLabourSheetSchema = z.object({
  date: z.string().trim().min(1, "Choose a date"),
  rows: z
    .array(
      z.object({
        workerId: objectId,
        contractorId: objectId,
        status: z.enum(CONTRACT_ATTENDANCE_STATUSES),
        checkIn: hhmm,
        checkOut: hhmm,
        notes: z.string().trim().max(300).optional().default(""),
      })
    )
    .min(1, "Nothing to save")
    .max(2000),
});

/** Saves a day's attendance for many workers at once (one row per worker per day). */
export async function saveLabourSheet(ctx: AuthContext, input: z.infer<typeof saveLabourSheetSchema>) {
  const date = toDay(input.date);
  const [{ workers, contractors }, cal] = await Promise.all([workersOn(ctx, date), loadCalendar(ctx.businessId, date, date)]);
  const byId = new Map(workers.map((w) => [String(w._id), w]));

  const ops = [];
  let overtimeMinutes = 0;
  for (const row of input.rows) {
    const worker = byId.get(row.workerId);
    if (!worker) throw AppError.badRequest("One of the workers is not on the rolls on this date", "WORKER_NOT_ACTIVE");
    const contractor = contractors.get(row.contractorId);
    if (!contractor || !(worker.contractorIds as Types.ObjectId[]).some((id) => String(id) === row.contractorId)) {
      throw AppError.badRequest(`${worker.name} does not work under the chosen contractor`, "WORKER_NOT_UNDER_CONTRACTOR");
    }
    const working = WORKING.has(row.status);
    const shift = workerShift(cal, worker, contractor);
    const t = working
      ? dayOvertimeMinutes(shift, row.checkIn, row.checkOut, Number(contractor.minOvertimeMinutes ?? 0))
      : { workedMinutes: 0, overtimeMinutes: 0 };
    overtimeMinutes += t.overtimeMinutes;
    ops.push({
      updateOne: {
        filter: { businessId: ctx.businessId, workerId: worker._id, date },
        update: {
          $set: {
            contractorId: contractor._id,
            status: row.status,
            checkIn: working ? row.checkIn : "",
            checkOut: working ? row.checkOut : "",
            workedMinutes: t.workedMinutes,
            overtimeMinutes: t.overtimeMinutes,
            overtimeManual: false,
            notes: row.notes,
            updatedBy: ctx.userId,
          },
          $setOnInsert: { createdBy: ctx.userId },
        },
        upsert: true,
      },
    });
  }
  if (ops.length > 0) await ContractAttendance.bulkWrite(ops);

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.contract-attendance",
    documentType: "Contract labour attendance",
    newValue: { date: dayKey(date), saved: ops.length, overtimeMinutes },
  });

  return { date: dayKey(date), saved: ops.length };
}

/* ------------------------------------------------------------------ */
/* Monthly overtime & wages                                            */
/* ------------------------------------------------------------------ */

export interface OvertimeRow {
  workerId: string;
  workerCode: string;
  name: string;
  contractorId: string;
  contractor: string;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  payableDays: string;
  dailyWage: string;
  wages: string;
  overtimeDays: number;
  overtimeMinutes: number;
  overtimeHours: string;
  overtimeRate: string;
  overtimeAmount: string;
  total: string;
}

/**
 * Days, wages and overtime per worker per contractor for a month. A worker who
 * worked for two contractors gets a row under each. Wages are day wage ×
 * payable days (a half day counts half); overtime is paid per hour at
 * `overtimeHourlyRate`.
 */
export async function overtimeReport(ctx: AuthContext, year: number, month: number, contractorId?: string) {
  const { start, end } = monthRange(year, month);
  const match: Record<string, unknown> = { businessId: ctx.businessId, date: { $gte: start, $lte: end } };
  if (contractorId) {
    if (!Types.ObjectId.isValid(contractorId)) throw AppError.badRequest("Choose a valid contractor", "BAD_CONTRACTOR");
    match.contractorId = new Types.ObjectId(contractorId);
  }
  const records = await ContractAttendance.find(match, { workerId: 1, contractorId: 1, status: 1, overtimeMinutes: 1 }).lean<AnyDoc[]>();
  const [workers, contractors, shifts] = await Promise.all([
    ContractWorker.find({ businessId: ctx.businessId, _id: { $in: [...new Set(records.map((r) => String(r.workerId)))] } }).lean<AnyDoc[]>(),
    Contractor.find({ businessId: ctx.businessId, _id: { $in: [...new Set(records.map((r) => String(r.contractorId)))] } }).lean<AnyDoc[]>(),
    Shift.find({ businessId: ctx.businessId }, { fullDayHours: 1, isDefault: 1, status: 1, deletedAt: 1 }).lean<AnyDoc[]>(),
  ]);
  const wById = new Map(workers.map((w) => [String(w._id), w]));
  const cById = new Map(contractors.map((c) => [String(c._id), c]));
  const shiftHours = new Map(shifts.map((s) => [String(s._id), Number(s.fullDayHours ?? 8)]));
  const def = shifts.find((s) => s.isDefault && !s.deletedAt && s.status === "ACTIVE");
  const defaultHours = def ? Number(def.fullDayHours ?? 8) : 8;

  type Acc = { present: number; half: number; absent: number; otDays: number; otMinutes: number };
  const groups = new Map<string, Acc>();
  for (const r of records) {
    const key = `${r.workerId}:${r.contractorId}`;
    const a = groups.get(key) ?? { present: 0, half: 0, absent: 0, otDays: 0, otMinutes: 0 };
    if (r.status === "PRESENT") a.present += 1;
    else if (r.status === "HALF_DAY") a.half += 1;
    else if (r.status === "ABSENT") a.absent += 1;
    if (r.overtimeMinutes > 0) {
      a.otDays += 1;
      a.otMinutes += r.overtimeMinutes;
    }
    groups.set(key, a);
  }

  const rows: OvertimeRow[] = [];
  for (const [key, a] of groups) {
    const [wId, cId] = key.split(":");
    const w = wById.get(wId);
    const c = cById.get(cId);
    if (!w || !c) continue;
    const dailyWage = dec(w.dailyWage).gt(0) ? dec(w.dailyWage) : dec(c.defaultDailyWage);
    const shiftId = w.shiftId ?? c.shiftId;
    const fullDayHours = shiftId ? shiftHours.get(String(shiftId)) ?? defaultHours : defaultHours;
    const rate = overtimeHourlyRate({
      workerRate: w.overtimeRatePerHour,
      rateType: c.overtimeRateType ?? "MULTIPLIER",
      fixedRate: c.overtimeRatePerHour,
      multiplier: Number(c.overtimeMultiplier ?? 2),
      dailyWage,
      fullDayHours,
    });
    const payable = new Decimal(a.present).plus(new Decimal(a.half).dividedBy(2));
    const wages = dailyWage.times(payable).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const ot = overtimeAmount(a.otMinutes, rate);
    rows.push({
      workerId: wId,
      workerCode: w.workerCode,
      name: w.name,
      contractorId: cId,
      contractor: c.name,
      presentDays: a.present,
      halfDays: a.half,
      absentDays: a.absent,
      payableDays: payable.toString(),
      dailyWage: dailyWage.toFixed(2),
      wages: wages.toFixed(2),
      overtimeDays: a.otDays,
      overtimeMinutes: a.otMinutes,
      overtimeHours: hoursOf(a.otMinutes),
      overtimeRate: rate.toFixed(2),
      overtimeAmount: ot.toFixed(2),
      total: wages.plus(ot).toFixed(2),
    });
  }
  rows.sort((x, y) => x.contractor.localeCompare(y.contractor) || x.workerCode.localeCompare(y.workerCode));

  const byContractor = new Map<string, { contractorId: string; contractor: string; workers: number; overtimeMinutes: number; wages: Decimal; overtimeAmount: Decimal }>();
  for (const r of rows) {
    const t = byContractor.get(r.contractorId) ?? { contractorId: r.contractorId, contractor: r.contractor, workers: 0, overtimeMinutes: 0, wages: ZERO, overtimeAmount: ZERO };
    t.workers += 1;
    t.overtimeMinutes += r.overtimeMinutes;
    t.wages = t.wages.plus(r.wages);
    t.overtimeAmount = t.overtimeAmount.plus(r.overtimeAmount);
    byContractor.set(r.contractorId, t);
  }
  const contractorTotals = [...byContractor.values()].map((t) => ({
    contractorId: t.contractorId,
    contractor: t.contractor,
    workers: t.workers,
    overtimeHours: hoursOf(t.overtimeMinutes),
    wages: t.wages.toFixed(2),
    overtimeAmount: t.overtimeAmount.toFixed(2),
    total: t.wages.plus(t.overtimeAmount).toFixed(2),
  }));
  const sum = (k: "wages" | "overtimeAmount") => rows.reduce((s, r) => s.plus(r[k]), ZERO);
  const totalMinutes = rows.reduce((s, r) => s + r.overtimeMinutes, 0);

  return {
    year,
    month,
    rows,
    contractorTotals,
    totals: {
      overtimeHours: hoursOf(totalMinutes),
      wages: sum("wages").toFixed(2),
      overtimeAmount: sum("overtimeAmount").toFixed(2),
      total: sum("wages").plus(sum("overtimeAmount")).toFixed(2),
    },
  };
}

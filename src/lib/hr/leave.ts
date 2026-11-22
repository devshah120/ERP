import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Attendance, LeaveApplication, LeaveAllocation, LeaveType, Employee } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, loadCalendar, shiftFor, workingDays } from "./calendar";
import { assertPayrollOpen } from "./attendance";
import { nextHrNumber, findEmployee, selfEmployee, employeeLabels, objectId, escapeRegex, pageQuery, type AnyDoc } from "./common";

export const applyLeaveSchema = z
  .object({
    employeeId: objectId.optional(),
    leaveTypeId: objectId,
    fromDate: z.string().trim().min(1, "Choose the first day"),
    toDate: z.string().trim().min(1, "Choose the last day"),
    halfDay: z.coerce.boolean().default(false),
    reason: z.string().trim().max(1000).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (Date.parse(v.toDate) < Date.parse(v.fromDate)) ctx.addIssue({ code: "custom", path: ["toDate"], message: "Last day is before the first day" });
    if (v.halfDay && v.fromDate.slice(0, 10) !== v.toDate.slice(0, 10)) ctx.addIssue({ code: "custom", path: ["halfDay"], message: "A half day is a single date" });
  });

export const decisionSchema = z.object({ note: z.string().trim().max(500).optional().default("") });

export const allocationSchema = z.object({
  employeeId: objectId,
  leaveTypeId: objectId,
  year: z.coerce.number().int().min(2000).max(2100),
  allocated: z.coerce.number().min(0).max(365),
  carriedForward: z.coerce.number().min(0).max(365).default(0),
  notes: z.string().trim().max(300).optional().default(""),
});

/* ------------------------------------------------------------------ */
/* Balances                                                            */
/* ------------------------------------------------------------------ */

export interface LeaveBalance {
  leaveTypeId: string;
  code: string;
  name: string;
  isPaid: boolean;
  allowNegative: boolean;
  allowHalfDay: boolean;
  allocated: number;
  /** True when `allocated` is the quota pro-rated for a mid-year joiner (no grant set by hand). */
  prorated: boolean;
  carriedForward: number;
  used: number;
  pending: number;
  available: number;
}

/**
 * The yearly quota for someone who joined in `year`: the months left counting
 * the joining month when they joined on or before the 15th, rounded to the
 * nearest half day. Earlier joiners get the full quota; future joiners none.
 */
export function proratedQuota(quota: number, year: number, dateOfJoining: Date | null | undefined): number {
  if (!dateOfJoining) return quota;
  const joined = new Date(dateOfJoining);
  if (joined.getUTCFullYear() < year) return quota;
  if (joined.getUTCFullYear() > year) return 0;
  const months = 12 - joined.getUTCMonth() - (joined.getUTCDate() > 15 ? 1 : 0);
  return Math.round(((quota * months) / 12) * 2) / 2;
}

function yearRange(year: number) {
  return { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) };
}

/**
 * Every leave type's balance for a set of employees in a calendar year:
 * granted (the year's allocation, or the type's annual quota when none has
 * been set) plus carry-forward, less approved days; pending requests are
 * shown separately and held against what can still be applied for.
 */
export async function balancesFor(businessId: Types.ObjectId, employeeIds: Types.ObjectId[], year: number): Promise<Map<string, LeaveBalance[]>> {
  const { start, end } = yearRange(year);
  const [types, allocations, apps, emps] = await Promise.all([
    LeaveType.find({ businessId, deletedAt: null, status: "ACTIVE" }).sort({ code: 1 }).lean<AnyDoc[]>(),
    LeaveAllocation.find({ businessId, year, employeeId: { $in: employeeIds } }).lean<AnyDoc[]>(),
    LeaveApplication.aggregate([
      { $match: { businessId, employeeId: { $in: employeeIds }, status: { $in: ["APPROVED", "PENDING"] }, fromDate: { $gte: start, $lte: end } } },
      { $group: { _id: { e: "$employeeId", t: "$leaveTypeId", s: "$status" }, days: { $sum: "$days" } } },
    ]),
    Employee.find({ businessId, _id: { $in: employeeIds } }, { dateOfJoining: 1 }).lean<AnyDoc[]>(),
  ]);
  const joinedOn = new Map(emps.map((e) => [String(e._id), e.dateOfJoining as Date]));
  const alloc = new Map(allocations.map((a) => [`${a.employeeId}:${a.leaveTypeId}`, a]));
  const usage = new Map<string, number>(apps.map((a: AnyDoc) => [`${a._id.e}:${a._id.t}:${a._id.s}`, a.days as number]));

  const out = new Map<string, LeaveBalance[]>();
  for (const eid of employeeIds) {
    out.set(
      String(eid),
      types.map((t) => {
        const a = alloc.get(`${eid}:${t._id}`);
        const quota = t.annualQuota ?? 0;
        const byHand = a && a.allocated !== null && a.allocated !== undefined;
        const fromQuota = t.prorateForJoiners === false ? quota : proratedQuota(quota, year, joinedOn.get(String(eid)));
        const allocated = byHand ? a.allocated : fromQuota;
        const carriedForward = a ? a.carriedForward ?? 0 : 0;
        const used = usage.get(`${eid}:${t._id}:APPROVED`) ?? 0;
        const pending = usage.get(`${eid}:${t._id}:PENDING`) ?? 0;
        return {
          leaveTypeId: String(t._id),
          code: t.code,
          name: t.name,
          isPaid: t.isPaid !== false,
          allowNegative: Boolean(t.allowNegative),
          allowHalfDay: t.allowHalfDay !== false,
          allocated,
          prorated: !byHand && fromQuota !== quota,
          carriedForward,
          used,
          pending,
          available: allocated + carriedForward - used,
        };
      })
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

async function leaveDays(businessId: Types.ObjectId, emp: AnyDoc, from: Date, to: Date, halfDay: boolean) {
  const cal = await loadCalendar(businessId, from, to);
  const days = workingDays(cal, shiftFor(cal, emp.shiftId), from, to);
  return { dates: days, count: halfDay ? (days.length > 0 ? 0.5 : 0) : days.length };
}

/** Days this request would take, without saving — the form shows it live. */
export async function previewLeave(ctx: AuthContext, input: { employeeId: string; fromDate: string; toDate: string; halfDay: boolean }) {
  const emp = await findEmployee(ctx.businessId, input.employeeId);
  const from = toDay(input.fromDate);
  const to = toDay(input.toDate);
  if (to < from) return { days: 0 };
  const { count } = await leaveDays(ctx.businessId, emp, from, to, input.halfDay);
  return { days: count };
}

/**
 * Files a leave request. HR may file for anyone; through self-service the
 * employee is always the signed-in person's own profile.
 */
export async function applyLeave(ctx: AuthContext, input: z.infer<typeof applyLeaveSchema>, opts: { self: boolean }) {
  const emp = opts.self ? await selfEmployee(ctx) : await findEmployee(ctx.businessId, input.employeeId ?? "");
  const type = await LeaveType.findOne({ _id: input.leaveTypeId, businessId: ctx.businessId, deletedAt: null, status: "ACTIVE" }).lean<AnyDoc>();
  if (!type) throw AppError.badRequest("Choose an active leave type", "LEAVE_TYPE_NOT_FOUND");
  if (input.halfDay && type.allowHalfDay === false) throw AppError.badRequest(`${type.name} cannot be taken as a half day`, "NO_HALF_DAY");

  const from = toDay(input.fromDate);
  const to = toDay(input.toDate);
  if (from < toDay(emp.dateOfJoining)) throw AppError.badRequest("Leave cannot start before the joining date", "BEFORE_JOINING");

  const { count } = await leaveDays(ctx.businessId, emp, from, to, input.halfDay);
  if (count <= 0) throw AppError.badRequest("Those dates are all weekly offs or holidays — there is nothing to take leave for.", "NO_WORKING_DAYS");

  const overlap = await LeaveApplication.findOne({
    businessId: ctx.businessId,
    employeeId: emp._id,
    status: { $in: ["PENDING", "APPROVED"] },
    fromDate: { $lte: to },
    toDate: { $gte: from },
  }).lean<AnyDoc>();
  if (overlap) throw AppError.conflict(`These dates overlap leave request ${overlap.leaveNumber}`, "LEAVE_OVERLAP");

  const balance = (await balancesFor(ctx.businessId, [emp._id], from.getUTCFullYear())).get(String(emp._id))?.find((b) => b.leaveTypeId === String(type._id));
  if (balance && !balance.allowNegative && balance.available - balance.pending < count) {
    throw AppError.badRequest(
      `Not enough ${type.name}: ${balance.available - balance.pending} day(s) left after pending requests, ${count} requested.`,
      "INSUFFICIENT_BALANCE"
    );
  }

  const leaveNumber = await nextHrNumber(ctx.businessId, "HR_LEAVE", "LV");
  const app = await LeaveApplication.create({
    businessId: ctx.businessId,
    leaveNumber,
    employeeId: emp._id,
    leaveTypeId: type._id,
    fromDate: from,
    toDate: to,
    halfDay: input.halfDay,
    days: count,
    reason: input.reason,
    status: "PENDING",
    appliedByUserId: ctx.userId,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });

  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.leave", documentType: "LeaveApplication", documentId: app._id, newValue: { leaveNumber, days: count } });
  return { id: String(app._id), leaveNumber, days: count };
}

/* ------------------------------------------------------------------ */
/* Decide                                                              */
/* ------------------------------------------------------------------ */

async function loadApp(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Leave request not found");
  const app = await LeaveApplication.findOne({ _id: id, businessId: ctx.businessId });
  if (!app) throw AppError.notFound("Leave request not found");
  return app;
}

/**
 * Approves a pending request and marks each working day it covers as leave
 * on the attendance sheet, in one transaction so the two never disagree.
 */
export async function approveLeave(ctx: AuthContext, id: string, note: string, opts: { asManager?: boolean } = {}) {
  const app = await loadApp(ctx, id);
  if (app.status !== "PENDING") throw AppError.badRequest(`This request is already ${app.status.toLowerCase()}`, "LEAVE_NOT_PENDING");

  const emp = await findEmployee(ctx.businessId, app.employeeId);
  const type = await LeaveType.findOne({ _id: app.leaveTypeId, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!type) throw AppError.badRequest("The leave type no longer exists", "LEAVE_TYPE_NOT_FOUND");

  const { dates } = await leaveDays(ctx.businessId, emp, toDay(app.fromDate), toDay(app.toDate), app.halfDay);
  await assertPayrollOpen(ctx.businessId, dates);

  const balance = (await balancesFor(ctx.businessId, [emp._id], toDay(app.fromDate).getUTCFullYear())).get(String(emp._id))?.find((b) => b.leaveTypeId === String(type._id));
  if (balance && !balance.allowNegative && balance.available < app.days) {
    throw AppError.badRequest(`Not enough ${type.name} left to approve: ${balance.available} day(s) available, ${app.days} requested.`, "INSUFFICIENT_BALANCE");
  }

  const isPaid = type.isPaid !== false;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const d of dates) {
        await Attendance.updateOne(
          { businessId: ctx.businessId, employeeId: emp._id, date: d },
          {
            $set: {
              status: app.halfDay ? "HALF_DAY" : "LEAVE",
              source: "LEAVE",
              leaveApplicationId: app._id,
              leaveIsPaid: isPaid,
              notes: `${type.code} · ${app.leaveNumber}`,
              updatedBy: ctx.userId,
              ...(app.halfDay ? {} : { checkIn: "", checkOut: "", workedMinutes: 0, lateMinutes: 0, overtimeMinutes: 0 }),
            },
            $setOnInsert: { createdBy: ctx.userId },
          },
          { upsert: true, session }
        );
      }
      app.set({ status: "APPROVED", decidedByUserId: ctx.userId, decidedAt: new Date(), decidedAs: opts.asManager ? "MANAGER" : "HR", decisionNote: note, updatedBy: ctx.userId });
      await app.save({ session });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.leave", documentType: "LeaveApplication", documentId: app._id, newValue: { status: "APPROVED", decidedAs: opts.asManager ? "MANAGER" : "HR" }, reason: note || undefined });
  return { id: String(app._id), status: "APPROVED" };
}

export async function rejectLeave(ctx: AuthContext, id: string, note: string, opts: { asManager?: boolean } = {}) {
  const app = await loadApp(ctx, id);
  if (app.status !== "PENDING") throw AppError.badRequest(`This request is already ${app.status.toLowerCase()}`, "LEAVE_NOT_PENDING");
  app.set({ status: "REJECTED", decidedByUserId: ctx.userId, decidedAt: new Date(), decidedAs: opts.asManager ? "MANAGER" : "HR", decisionNote: note, updatedBy: ctx.userId });
  await app.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.leave", documentType: "LeaveApplication", documentId: app._id, newValue: { status: "REJECTED", decidedAs: opts.asManager ? "MANAGER" : "HR" }, reason: note || undefined });
  return { id: String(app._id), status: "REJECTED" };
}

/**
 * Withdraws a request. Employees can withdraw their own pending requests; HR
 * can also cancel an approved one, which clears the leave days it put on the
 * attendance sheet (unless that month's payroll is already locked).
 */
export async function cancelLeave(ctx: AuthContext, id: string, opts: { self: boolean; note?: string }) {
  const app = await loadApp(ctx, id);
  if (opts.self) {
    const emp = await selfEmployee(ctx);
    if (String(app.employeeId) !== String(emp._id)) throw AppError.notFound("Leave request not found");
    if (app.status !== "PENDING") throw AppError.badRequest("Only a pending request can be withdrawn. Ask HR to cancel an approved leave.", "LEAVE_NOT_PENDING");
  }
  if (app.status !== "PENDING" && app.status !== "APPROVED") throw AppError.badRequest(`This request is already ${app.status.toLowerCase()}`, "LEAVE_NOT_CANCELLABLE");

  if (app.status === "APPROVED") {
    const rows = await Attendance.find({ businessId: ctx.businessId, leaveApplicationId: app._id }, { date: 1 }).lean<AnyDoc[]>();
    await assertPayrollOpen(ctx.businessId, rows.map((r) => toDay(r.date)));
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Attendance.deleteMany({ businessId: ctx.businessId, leaveApplicationId: app._id }, { session });
        app.set({ status: "CANCELLED", decisionNote: opts.note ?? app.decisionNote, updatedBy: ctx.userId });
        await app.save({ session });
      });
    } finally {
      await session.endSession();
    }
  } else {
    app.set({ status: "CANCELLED", decisionNote: opts.note ?? "", updatedBy: ctx.userId });
    await app.save();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.leave", documentType: "LeaveApplication", documentId: app._id, newValue: { status: "CANCELLED" }, reason: opts.note || undefined });
  return { id: String(app._id), status: "CANCELLED" };
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

export const leaveListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(),
  employeeId: z.string().trim().optional(),
  fromDate: z.string().trim().optional(),
  toDate: z.string().trim().optional(),
  ...pageQuery,
});

export async function listLeaves(ctx: AuthContext, params: z.infer<typeof leaveListSchema>, opts: { employeeId?: Types.ObjectId; employeeIds?: Types.ObjectId[] } = {}) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.status) filter.status = params.status;
  const scope = opts.employeeId ? { employeeId: opts.employeeId } : opts.employeeIds ? { employeeId: { $in: opts.employeeIds } } : {};
  if (opts.employeeId || opts.employeeIds) Object.assign(filter, scope);
  else if (params.employeeId && Types.ObjectId.isValid(params.employeeId)) filter.employeeId = new Types.ObjectId(params.employeeId);
  if (params.fromDate) filter.toDate = { $gte: toDay(params.fromDate) };
  if (params.toDate) filter.fromDate = { $lte: toDay(params.toDate) };
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    const emps = await Employee.find({ businessId: ctx.businessId, $or: [{ name: rx }, { employeeCode: rx }] }, { _id: 1 }).lean<AnyDoc[]>();
    filter.$or = [{ leaveNumber: rx }, { employeeId: { $in: emps.map((e) => e._id) } }];
  }

  const [rows, total, types] = await Promise.all([
    LeaveApplication.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    LeaveApplication.countDocuments(filter),
    LeaveType.find({ businessId: ctx.businessId }, { code: 1, name: 1 }).lean<AnyDoc[]>(),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  const typeMap = new Map(types.map((t) => [String(t._id), t]));
  const pending = await LeaveApplication.countDocuments({ businessId: ctx.businessId, status: "PENDING", ...scope });

  return {
    items: rows.map((r) => {
      const t = typeMap.get(String(r.leaveTypeId));
      const e = labels.get(String(r.employeeId));
      return {
        id: String(r._id),
        leaveNumber: r.leaveNumber,
        employeeId: String(r.employeeId),
        employeeName: e?.name ?? "—",
        employeeCode: e?.code ?? "",
        department: e?.department ?? "",
        leaveType: t ? `${t.code} · ${t.name}` : "—",
        leaveTypeCode: t?.code ?? "",
        fromDate: dayKey(toDay(r.fromDate)),
        toDate: dayKey(toDay(r.toDate)),
        halfDay: r.halfDay,
        days: r.days,
        reason: r.reason,
        status: r.status,
        decisionNote: r.decisionNote,
        decidedAt: r.decidedAt,
        decidedAs: r.decidedAs ?? "",
        createdAt: r.createdAt,
      };
    }),
    total,
    pending,
  };
}

/** Employees × leave types for a year, for the balances screen. */
export async function balancesTable(ctx: AuthContext, year: number, query?: string) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: ["PROBATION", "CONFIRMED", "ON_NOTICE"] } };
  if (query) {
    const rx = { $regex: escapeRegex(query), $options: "i" };
    filter.$or = [{ name: rx }, { employeeCode: rx }];
  }
  const emps = await Employee.find(filter, { employeeCode: 1, name: 1 }).sort({ employeeCode: 1 }).limit(500).lean<AnyDoc[]>();
  const balances = await balancesFor(ctx.businessId, emps.map((e) => e._id), year);
  const types = await LeaveType.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE" }, { code: 1, name: 1, annualQuota: 1 }).sort({ code: 1 }).lean<AnyDoc[]>();
  return {
    year,
    leaveTypes: types.map((t) => ({ id: String(t._id), code: t.code, name: t.name, annualQuota: t.annualQuota })),
    rows: emps.map((e) => ({ employeeId: String(e._id), employeeCode: e.employeeCode, name: e.name, balances: balances.get(String(e._id)) ?? [] })),
  };
}

export async function setAllocation(ctx: AuthContext, input: z.infer<typeof allocationSchema>) {
  await findEmployee(ctx.businessId, input.employeeId);
  const type = await LeaveType.findOne({ _id: input.leaveTypeId, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!type) throw AppError.badRequest("Leave type not found", "LEAVE_TYPE_NOT_FOUND");
  const doc = await LeaveAllocation.findOneAndUpdate(
    { businessId: ctx.businessId, employeeId: new Types.ObjectId(input.employeeId), leaveTypeId: type._id, year: input.year },
    { $set: { allocated: input.allocated, carriedForward: input.carriedForward, notes: input.notes, updatedBy: ctx.userId }, $setOnInsert: { createdBy: ctx.userId } },
    { upsert: true, new: true }
  );
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.leave", documentType: "LeaveAllocation", documentId: doc._id, newValue: input });
  return { id: String(doc._id) };
}

/* ------------------------------------------------------------------ */
/* Reporting managers                                                  */
/* ------------------------------------------------------------------ */

/** The signed-in employee's direct reports who are still on the rolls. */
export async function directReports(ctx: AuthContext): Promise<AnyDoc[]> {
  const me = await selfEmployee(ctx);
  return Employee.find(
    { businessId: ctx.businessId, reportingManagerId: me._id, _id: { $ne: me._id }, deletedAt: null },
    { _id: 1, employeeCode: 1, name: 1 }
  )
    .sort({ employeeCode: 1 })
    .lean<AnyDoc[]>();
}

/** Leave requests of the signed-in manager's direct reports. */
export async function listTeamLeaves(ctx: AuthContext, params: z.infer<typeof leaveListSchema>) {
  const team = await directReports(ctx);
  if (team.length === 0) throw AppError.forbidden("No one reports to you, so there is no team leave to review.", "NOT_A_MANAGER");
  return { ...(await listLeaves(ctx, params, { employeeIds: team.map((e) => e._id) })), teamSize: team.length };
}

/**
 * A reporting manager approves or rejects a direct report's pending request.
 * The manager's decision is final; HR can still cancel an approved leave.
 * Anyone outside the manager's team gets a plain "not found".
 */
export async function decideTeamLeave(ctx: AuthContext, id: string, action: "approve" | "reject", note: string) {
  const app = await loadApp(ctx, id);
  const team = await directReports(ctx);
  if (!team.some((e) => String(e._id) === String(app.employeeId))) throw AppError.notFound("Leave request not found");
  if (action === "reject" && !note.trim()) throw AppError.badRequest("Give a reason for rejecting", "REASON_REQUIRED");
  return action === "approve" ? approveLeave(ctx, id, note, { asManager: true }) : rejectLeave(ctx, id, note, { asManager: true });
}

/* ------------------------------------------------------------------ */
/* Year-end carry-forward                                              */
/* ------------------------------------------------------------------ */

export const carryForwardSchema = z.object({
  fromYear: z.coerce.number().int().min(2000).max(2100),
  /** false = preview only. */
  commit: z.boolean().optional().default(false),
});

/**
 * Moves each employee's unused days of every carry-forward leave type from
 * `fromYear` into the next year, up to the type's limit; the rest lapse.
 * Preview first, then commit. Running it again recalculates and overwrites
 * the carried days (a grant set by hand for the new year is kept).
 */
export async function carryForwardLeave(ctx: AuthContext, input: z.infer<typeof carryForwardSchema>) {
  const { fromYear, commit } = input;
  const toYear = fromYear + 1;
  const types = await LeaveType.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE", carryForward: true }).sort({ code: 1 }).lean<AnyDoc[]>();
  const emps = await Employee.find(
    { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: ["PROBATION", "CONFIRMED", "ON_NOTICE"] } },
    { employeeCode: 1, name: 1 }
  )
    .sort({ employeeCode: 1 })
    .lean<AnyDoc[]>();
  if (types.length === 0 || emps.length === 0) {
    return { fromYear, toYear, committed: false, leaveTypes: [], rows: [], totals: { carried: 0, lapsed: 0 } };
  }

  const ids = emps.map((e) => e._id);
  const [balances, existing] = await Promise.all([
    balancesFor(ctx.businessId, ids, fromYear),
    LeaveAllocation.find({ businessId: ctx.businessId, year: toYear, employeeId: { $in: ids }, leaveTypeId: { $in: types.map((t) => t._id) } }).lean<AnyDoc[]>(),
  ]);
  const current = new Map(existing.map((a) => [`${a.employeeId}:${a.leaveTypeId}`, a.carriedForward ?? 0]));

  const rows = [];
  let carriedTotal = 0;
  let lapsedTotal = 0;
  for (const e of emps) {
    for (const t of types) {
      const b = balances.get(String(e._id))?.find((x) => x.leaveTypeId === String(t._id));
      const unused = Math.max(0, b?.available ?? 0);
      const cap = (t.maxCarryForward ?? 0) > 0 ? t.maxCarryForward : Infinity;
      const carried = Math.min(unused, cap);
      const before = current.get(`${e._id}:${t._id}`) ?? 0;
      if (unused === 0 && before === 0) continue;
      carriedTotal += carried;
      lapsedTotal += unused - carried;
      rows.push({ employeeId: String(e._id), employeeCode: e.employeeCode, name: e.name, leaveTypeId: String(t._id), code: t.code, unused, carried, lapsed: unused - carried, before });
    }
  }

  if (commit && rows.length > 0) {
    await LeaveAllocation.bulkWrite(
      rows.map((r) => ({
        updateOne: {
          filter: { businessId: ctx.businessId, employeeId: new Types.ObjectId(r.employeeId), leaveTypeId: new Types.ObjectId(r.leaveTypeId), year: toYear },
          update: { $set: { carriedForward: r.carried, updatedBy: ctx.userId }, $setOnInsert: { allocated: null, notes: `Carried forward from ${fromYear}`, createdBy: ctx.userId } },
          upsert: true,
        },
      }))
    );
    await recordAudit({
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: "UPDATE",
      module: "hr.leave",
      documentType: "LeaveAllocation",
      newValue: { carryForward: `${fromYear} → ${toYear}`, employees: new Set(rows.map((r) => r.employeeId)).size, carried: carriedTotal, lapsed: lapsedTotal },
    });
  }

  return {
    fromYear,
    toYear,
    committed: commit && rows.length > 0,
    leaveTypes: types.map((t) => ({ id: String(t._id), code: t.code, name: t.name, maxCarryForward: t.maxCarryForward ?? 0 })),
    rows,
    totals: { carried: carriedTotal, lapsed: lapsedTotal },
  };
}


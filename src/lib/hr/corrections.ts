import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Attendance, AttendanceRequest, CORRECTION_STATUSES, Employee } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, todayIn, loadCalendar, shiftFor } from "./calendar";
import { computeTimes, assertPayrollOpen } from "./attendance";
import { directReports } from "./leave";
import { nextHrNumber, findEmployee, selfEmployee, employeeLabels, businessTimeZone, escapeRegex, pageQuery, type AnyDoc } from "./common";

/*
 * Attendance correction (regularization) requests: an employee asks for one
 * day to be set to present, half day or on duty, optionally with times. Their
 * reporting manager or HR approves, which writes the day to the attendance
 * sheet. Approved leave and payroll-locked months cannot be corrected here.
 */

const hhmm = z.string().trim().regex(/^(([01]\d|2[0-3]):[0-5]\d)?$/, "Use HH:mm").optional().default("");

export const correctionSchema = z.object({
  date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
  status: z.enum(CORRECTION_STATUSES),
  checkIn: hhmm,
  checkOut: hhmm,
  reason: z.string().trim().min(3, "Say what should be corrected and why").max(500),
});

export const correctionListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(),
  ...pageQuery,
});

export const decideCorrectionSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().max(500).optional().default(""),
});

async function loadRequest(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Correction request not found");
  const req = await AttendanceRequest.findOne({ _id: id, businessId: ctx.businessId });
  if (!req) throw AppError.notFound("Correction request not found");
  return req;
}

/** The signed-in employee asks for one day of their attendance to be corrected. */
export async function requestCorrection(ctx: AuthContext, input: z.infer<typeof correctionSchema>) {
  const emp = await selfEmployee(ctx);
  const date = toDay(input.date);
  const today = todayIn(await businessTimeZone(ctx.businessId));
  if (date > today) throw AppError.badRequest("You can only correct today or an earlier day.", "FUTURE_DATE");
  if (date < toDay(emp.dateOfJoining) || (emp.dateOfExit && date > toDay(emp.dateOfExit))) {
    throw AppError.badRequest("You were not on the rolls on that day.", "EMPLOYEE_NOT_EMPLOYED");
  }
  await assertPayrollOpen(ctx.businessId, [date]);

  const current = await Attendance.findOne({ businessId: ctx.businessId, employeeId: emp._id, date }).lean<AnyDoc>();
  if (current?.leaveApplicationId) {
    throw AppError.badRequest("That day is covered by approved leave. Withdraw the leave or ask HR to cancel it instead.", "ON_LEAVE");
  }
  if (current && current.status === input.status && (current.checkIn ?? "") === input.checkIn && (current.checkOut ?? "") === input.checkOut) {
    throw AppError.badRequest("Your attendance for that day already shows this.", "NOTHING_TO_CHANGE");
  }
  const open = await AttendanceRequest.findOne({ businessId: ctx.businessId, employeeId: emp._id, date, status: "PENDING" }).lean<AnyDoc>();
  if (open) throw AppError.conflict(`You already have a pending request for that day (${open.requestNumber}).`, "CORRECTION_PENDING");

  const requestNumber = await nextHrNumber(ctx.businessId, "HR_ATTENDANCE_REQUEST", "AR");
  const doc = await AttendanceRequest.create({
    businessId: ctx.businessId,
    requestNumber,
    employeeId: emp._id,
    date,
    requestedStatus: input.status,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    reason: input.reason,
    previous: { status: current?.status ?? "", checkIn: current?.checkIn ?? "", checkOut: current?.checkOut ?? "" },
    appliedByUserId: ctx.userId,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "CREATE",
    module: "hr.attendance",
    documentType: "AttendanceRequest",
    documentId: doc._id,
    newValue: { requestNumber, date: dayKey(date), status: input.status, checkIn: input.checkIn, checkOut: input.checkOut },
  });
  return { id: String(doc._id), requestNumber };
}

/**
 * Approves a pending request: the day is written to the attendance sheet with
 * times worked out from the employee's shift, in the same transaction that
 * closes the request.
 */
export async function approveCorrection(ctx: AuthContext, id: string, note: string, opts: { asManager?: boolean } = {}) {
  const req = await loadRequest(ctx, id);
  if (req.status !== "PENDING") throw AppError.badRequest(`This request is already ${req.status.toLowerCase()}`, "CORRECTION_NOT_PENDING");
  const date = toDay(req.date);
  await assertPayrollOpen(ctx.businessId, [date]);

  const emp = await findEmployee(ctx.businessId, req.employeeId);
  const current = await Attendance.findOne({ businessId: ctx.businessId, employeeId: emp._id, date }).lean<AnyDoc>();
  if (current?.leaveApplicationId) {
    throw AppError.badRequest("That day has since been covered by approved leave, so it cannot be corrected here.", "ON_LEAVE");
  }

  const cal = await loadCalendar(ctx.businessId, date, date);
  const times = computeTimes(shiftFor(cal, emp.shiftId), req.checkIn, req.checkOut);
  const decidedAs = opts.asManager ? "MANAGER" : "HR";
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Attendance.updateOne(
        { businessId: ctx.businessId, employeeId: emp._id, date },
        {
          $set: {
            status: req.requestedStatus,
            checkIn: req.checkIn,
            checkOut: req.checkOut,
            ...times,
            source: "REQUEST",
            leaveApplicationId: null,
            leaveIsPaid: true,
            notes: `Correction ${req.requestNumber}`,
            updatedBy: ctx.userId,
          },
          $setOnInsert: { createdBy: ctx.userId },
        },
        { upsert: true, session }
      );
      req.set({ status: "APPROVED", decidedByUserId: ctx.userId, decidedAt: new Date(), decidedAs, decisionNote: note, updatedBy: ctx.userId });
      await req.save({ session });
    });
  } finally {
    await session.endSession();
  }

  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.attendance",
    documentType: "AttendanceRequest",
    documentId: req._id,
    oldValue: { status: current?.status ?? "", checkIn: current?.checkIn ?? "", checkOut: current?.checkOut ?? "" },
    newValue: { requestStatus: "APPROVED", decidedAs, date: dayKey(date), status: req.requestedStatus, checkIn: req.checkIn, checkOut: req.checkOut },
    reason: note || undefined,
  });
  return { id: String(req._id), status: "APPROVED" };
}

export async function rejectCorrection(ctx: AuthContext, id: string, note: string, opts: { asManager?: boolean } = {}) {
  if (!note.trim()) throw AppError.badRequest("Give a reason for rejecting", "REASON_REQUIRED");
  const req = await loadRequest(ctx, id);
  if (req.status !== "PENDING") throw AppError.badRequest(`This request is already ${req.status.toLowerCase()}`, "CORRECTION_NOT_PENDING");
  const decidedAs = opts.asManager ? "MANAGER" : "HR";
  req.set({ status: "REJECTED", decidedByUserId: ctx.userId, decidedAt: new Date(), decidedAs, decisionNote: note, updatedBy: ctx.userId });
  await req.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.attendance", documentType: "AttendanceRequest", documentId: req._id, newValue: { requestStatus: "REJECTED", decidedAs }, reason: note });
  return { id: String(req._id), status: "REJECTED" };
}

/** The employee withdraws their own pending request. */
export async function withdrawCorrection(ctx: AuthContext, id: string) {
  const emp = await selfEmployee(ctx);
  const req = await loadRequest(ctx, id);
  if (String(req.employeeId) !== String(emp._id)) throw AppError.notFound("Correction request not found");
  if (req.status !== "PENDING") throw AppError.badRequest("Only a pending request can be withdrawn.", "CORRECTION_NOT_PENDING");
  req.set({ status: "CANCELLED", updatedBy: ctx.userId });
  await req.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.attendance", documentType: "AttendanceRequest", documentId: req._id, newValue: { requestStatus: "CANCELLED" } });
  return { id: String(req._id), status: "CANCELLED" };
}

/** A reporting manager decides a direct report's request; anyone outside the team gets "not found". */
export async function decideTeamCorrection(ctx: AuthContext, id: string, action: "approve" | "reject", note: string) {
  const req = await loadRequest(ctx, id);
  const team = await directReports(ctx);
  if (!team.some((e) => String(e._id) === String(req.employeeId))) throw AppError.notFound("Correction request not found");
  return action === "approve" ? approveCorrection(ctx, id, note, { asManager: true }) : rejectCorrection(ctx, id, note, { asManager: true });
}

/* ------------------------------------------------------------------ */
/* Lists                                                               */
/* ------------------------------------------------------------------ */

async function listCorrections(ctx: AuthContext, params: z.infer<typeof correctionListSchema>, employeeIds?: Types.ObjectId[]) {
  const scope = employeeIds ? { employeeId: { $in: employeeIds } } : {};
  const filter: Record<string, unknown> = { businessId: ctx.businessId, ...scope };
  if (params.status) filter.status = params.status;
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    const emps = await Employee.find({ businessId: ctx.businessId, $or: [{ name: rx }, { employeeCode: rx }] }, { _id: 1 }).lean<AnyDoc[]>();
    filter.$or = [{ requestNumber: rx }, { employeeId: { $in: emps.map((e) => e._id) } }];
  }
  const [rows, total, pending] = await Promise.all([
    AttendanceRequest.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    AttendanceRequest.countDocuments(filter),
    AttendanceRequest.countDocuments({ businessId: ctx.businessId, status: "PENDING", ...scope }),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  return {
    items: rows.map((r) => {
      const e = labels.get(String(r.employeeId));
      return {
        id: String(r._id),
        requestNumber: r.requestNumber,
        employeeId: String(r.employeeId),
        employeeName: e?.name ?? "—",
        employeeCode: e?.code ?? "",
        department: e?.department ?? "",
        date: dayKey(toDay(r.date)),
        requestedStatus: r.requestedStatus,
        checkIn: r.checkIn ?? "",
        checkOut: r.checkOut ?? "",
        previous: { status: r.previous?.status ?? "", checkIn: r.previous?.checkIn ?? "", checkOut: r.previous?.checkOut ?? "" },
        reason: r.reason,
        status: r.status,
        decidedAs: r.decidedAs ?? "",
        decisionNote: r.decisionNote ?? "",
        decidedAt: r.decidedAt,
        createdAt: r.createdAt,
      };
    }),
    total,
    pending,
  };
}

/** Every request in the workspace, for HR. */
export function listAllCorrections(ctx: AuthContext, params: z.infer<typeof correctionListSchema>) {
  return listCorrections(ctx, params);
}

/** The signed-in employee's own requests. */
export async function listMyCorrections(ctx: AuthContext, params: z.infer<typeof correctionListSchema>) {
  const emp = await selfEmployee(ctx);
  return listCorrections(ctx, params, [emp._id]);
}

/** Requests from the signed-in manager's direct reports. */
export async function listTeamCorrections(ctx: AuthContext, params: z.infer<typeof correctionListSchema>) {
  const team = await directReports(ctx);
  if (team.length === 0) throw AppError.forbidden("No one reports to you, so there are no team requests to review.", "NOT_A_MANAGER");
  return { ...(await listCorrections(ctx, params, team.map((e) => e._id))), teamSize: team.length };
}

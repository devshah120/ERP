import mongoose, { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Attendance, PayrollRun, Payslip, EmployeeLoan, ExpenseClaim, Employee } from "@/models/hr";
import { Business } from "@/models/Business";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { serializeDoc } from "@/lib/resources/serialize";
import { amountInWords } from "@/lib/documents/numberToWords";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, eachDay, monthRange, loadCalendar, employeesDuring } from "./calendar";
import { summarizeMonth, type AttendanceRow } from "./attendance";
import { computePayslip } from "./payrollMath";
import { nextHrNumber, employeeLabels, selfEmployee, monthQuery, type AnyDoc } from "./common";

export const createRunSchema = monthQuery.extend({ notes: z.string().trim().max(500).optional().default("") });
export const payRunSchema = z.object({
  paidOn: z.string().trim().optional(),
  reference: z.string().trim().max(100).optional().default(""),
});
export const cancelRunSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(500) });

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthLabel = (month: number, year: number) => `${MONTHS[month - 1]} ${year}`;

const d = (v: unknown) => new Decimal(v ? String(v) : "0");
const dec128 = (v: Decimal) => toDecimal128(v);

async function loadRun(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Payroll run not found");
  const run = await PayrollRun.findOne({ _id: id, businessId: ctx.businessId });
  if (!run) throw AppError.notFound("Payroll run not found");
  return run;
}

/**
 * Builds every payslip for a run inside the caller's transaction: who was on
 * the rolls that month, their attendance (loss-of-pay days), salary
 * structure, active loan instalments and approved claims awaiting payment.
 */
async function generatePayslips(ctx: AuthContext, run: AnyDoc, session: ClientSession) {
  const { start, end, days: daysInMonth } = monthRange(run.year, run.month);
  const days = eachDay(start, end);
  const emps = await employeesDuring(ctx.businessId, start, end);
  if (emps.length === 0) throw AppError.badRequest(`No employees were on the rolls in ${monthLabel(run.month, run.year)}.`, "NO_EMPLOYEES");
  const ids = emps.map((e) => e._id);

  const [cal, attendance, loans, claims, labels] = await Promise.all([
    loadCalendar(ctx.businessId, start, end),
    Attendance.find({ businessId: ctx.businessId, employeeId: { $in: ids }, date: { $gte: start, $lte: end } }).session(session).lean<AnyDoc[]>(),
    EmployeeLoan.find({
      businessId: ctx.businessId,
      employeeId: { $in: ids },
      status: "ACTIVE",
      $or: [{ startYear: { $lt: run.year } }, { startYear: run.year, startMonth: { $lte: run.month } }],
    })
      .sort({ issueDate: 1 })
      .session(session)
      .lean<AnyDoc[]>(),
    ExpenseClaim.find({ businessId: ctx.businessId, employeeId: { $in: ids }, status: "APPROVED", payrollRunId: null, claimDate: { $lte: end } }).session(session).lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, ids),
  ]);

  const attendanceBy = new Map<string, Map<string, AttendanceRow>>();
  for (const a of attendance) {
    const k = String(a.employeeId);
    if (!attendanceBy.has(k)) attendanceBy.set(k, new Map());
    attendanceBy.get(k)!.set(dayKey(toDay(a.date)), a);
  }

  let totalGross = new Decimal(0);
  let totalReimb = new Decimal(0);
  let totalDed = new Decimal(0);
  let totalNet = new Decimal(0);
  let totalEmployer = new Decimal(0);
  const slips = [];

  for (const e of emps) {
    const key = String(e._id);
    const { summary } = summarizeMonth(e, cal, days, attendanceBy.get(key) ?? new Map());
    const myLoans = loans.filter((l) => String(l.employeeId) === key);
    const myClaims = claims.filter((c) => String(c.employeeId) === key);
    const result = computePayslip({
      structure: {
        basic: d(e.basic),
        hra: d(e.hra),
        conveyance: d(e.conveyance),
        specialAllowance: d(e.specialAllowance),
        otherAllowance: d(e.otherAllowance),
        pfApplicable: e.pfApplicable !== false,
        esiApplicable: Boolean(e.esiApplicable),
        ptApplicable: e.ptApplicable !== false,
        professionalTax: d(e.professionalTax),
        monthlyTds: d(e.monthlyTds),
      },
      daysInMonth,
      lopDays: summary.lopDays,
      loans: myLoans.map((l) => ({ loanId: String(l._id), emi: d(l.emiAmount), outstanding: d(l.amount).minus(d(l.repaidAmount)) })),
      reimbursements: myClaims.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0)),
    });
    const employerTotal = result.employerContributions.reduce((t, l) => t.plus(l.amount), new Decimal(0));
    const label = labels.get(key);

    totalGross = totalGross.plus(result.grossEarnings);
    totalReimb = totalReimb.plus(result.reimbursements);
    totalDed = totalDed.plus(result.totalDeductions);
    totalNet = totalNet.plus(result.netPay);
    totalEmployer = totalEmployer.plus(employerTotal);

    const line = (l: { code: string; label: string; amount: Decimal }) => ({ code: l.code, label: l.label, amount: dec128(l.amount) });
    slips.push({
      businessId: ctx.businessId,
      payrollRunId: run._id,
      employeeId: e._id,
      month: run.month,
      year: run.year,
      employee: {
        code: e.employeeCode,
        name: e.name,
        department: label?.department ?? "",
        designation: label?.designation ?? "",
        dateOfJoining: e.dateOfJoining,
        panNumber: e.panNumber ?? "",
        uanNumber: e.uanNumber ?? "",
        esiNumber: e.esiNumber ?? "",
        bankName: e.bankName ?? "",
        bankAccountNumber: e.bankAccountNumber ?? "",
        ifscCode: e.ifscCode ?? "",
        paymentMode: e.salaryPaymentMode ?? "BANK",
      },
      daysInMonth,
      payableDays: result.payableDays,
      lopDays: summary.lopDays,
      presentDays: summary.present + summary.onDuty + summary.unmarked,
      paidLeaveDays: summary.paidLeave,
      holidays: summary.holidays,
      weeklyOffs: summary.weeklyOffs,
      earnings: result.earnings.map(line),
      deductions: result.deductions.map(line),
      employerContributions: result.employerContributions.map(line),
      pfWages: dec128(result.pfWages),
      esiWages: dec128(result.esiWages),
      grossEarnings: dec128(result.grossEarnings),
      reimbursements: dec128(result.reimbursements),
      totalDeductions: dec128(result.totalDeductions),
      netPay: dec128(result.netPay),
      loanDeductions: result.loanDeductions.map((l) => ({ loanId: new Types.ObjectId(l.loanId), amount: dec128(l.amount) })),
      claimIds: myClaims.map((c) => c._id),
      status: "DRAFT",
    });
  }

  await Payslip.insertMany(slips, { session });
  await PayrollRun.updateOne(
    { _id: run._id, businessId: ctx.businessId },
    {
      employeeCount: slips.length,
      totalGross: dec128(totalGross),
      totalReimbursements: dec128(totalReimb),
      totalDeductions: dec128(totalDed),
      totalNet: dec128(totalNet),
      totalEmployerContribution: dec128(totalEmployer),
      updatedBy: ctx.userId,
    },
    { session }
  );
  return slips.length;
}

/** Starts a month's payroll as a draft with every payslip computed. One live run per month. */
export async function createRun(ctx: AuthContext, input: z.infer<typeof createRunSchema>) {
  const live = await PayrollRun.findOne({ businessId: ctx.businessId, year: input.year, month: input.month, status: { $ne: "CANCELLED" } }).lean<AnyDoc>();
  if (live) throw AppError.conflict(`Payroll for ${monthLabel(input.month, input.year)} already exists (${live.runNumber}).`, "PAYROLL_EXISTS");

  const { start, end } = monthRange(input.year, input.month);
  const session = await mongoose.startSession();
  const out: { id?: string; runNumber?: string; count?: number } = {};
  try {
    await session.withTransaction(async () => {
      const runNumber = await nextHrNumber(ctx.businessId, "HR_PAYROLL", "PAY", session);
      const [run] = await PayrollRun.create(
        [{ businessId: ctx.businessId, runNumber, month: input.month, year: input.year, periodStart: start, periodEnd: end, status: "DRAFT", notes: input.notes, createdBy: ctx.userId, updatedBy: ctx.userId }],
        { session }
      );
      out.count = await generatePayslips(ctx, run, session);
      out.id = String(run._id);
      out.runNumber = runNumber;
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.payroll", documentType: "PayrollRun", documentId: out.id, newValue: { month: input.month, year: input.year, payslips: out.count } });
  return { id: out.id!, runNumber: out.runNumber!, payslips: out.count! };
}

/** Throws the draft's payslips away and computes them again from today's data. */
export async function recomputeRun(ctx: AuthContext, id: string) {
  const run = await loadRun(ctx, id);
  if (run.status !== "DRAFT") throw AppError.badRequest("Only a draft payroll can be recalculated", "PAYROLL_NOT_DRAFT");
  const session = await mongoose.startSession();
  let count = 0;
  try {
    await session.withTransaction(async () => {
      await Payslip.deleteMany({ businessId: ctx.businessId, payrollRunId: run._id }, { session });
      count = await generatePayslips(ctx, run, session);
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.payroll", documentType: "PayrollRun", documentId: run._id, reason: "Recalculated" });
  return { id, payslips: count };
}

/**
 * Locks the payroll: loan instalments are recorded against their loans and
 * reimbursed claims are marked paid, all in one transaction. From here the
 * month's attendance and leave are frozen.
 */
export async function approveRun(ctx: AuthContext, id: string) {
  const run = await loadRun(ctx, id);
  if (run.status !== "DRAFT") throw AppError.badRequest(`This payroll is already ${run.status.toLowerCase()}`, "PAYROLL_NOT_DRAFT");
  const slips = await Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).lean<AnyDoc[]>();
  if (slips.length === 0) throw AppError.badRequest("This payroll has no payslips", "PAYROLL_EMPTY");

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const slip of slips) {
        for (const ld of slip.loanDeductions ?? []) {
          const loan = await EmployeeLoan.findOne({ _id: ld.loanId, businessId: ctx.businessId }).session(session);
          if (!loan) continue;
          const repaid = d(loan.repaidAmount).plus(d(ld.amount));
          loan.repayments.push({ payrollRunId: run._id, month: run.month, year: run.year, amount: ld.amount, note: `Payroll ${run.runNumber}` });
          loan.repaidAmount = dec128(repaid);
          if (repaid.gte(d(loan.amount))) loan.status = "CLOSED";
          loan.updatedBy = ctx.userId;
          await loan.save({ session });
        }
        if ((slip.claimIds ?? []).length > 0) {
          await ExpenseClaim.updateMany(
            { businessId: ctx.businessId, _id: { $in: slip.claimIds }, status: "APPROVED" },
            { status: "REIMBURSED", payrollRunId: run._id, updatedBy: ctx.userId },
            { session }
          );
        }
      }
      await Payslip.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "APPROVED" }, { session });
      run.set({ status: "APPROVED", approvedByUserId: ctx.userId, approvedAt: new Date(), updatedBy: ctx.userId });
      await run.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.payroll", documentType: "PayrollRun", documentId: run._id, newValue: { status: "APPROVED" } });
  return { id, status: "APPROVED" };
}

export async function markRunPaid(ctx: AuthContext, id: string, input: z.infer<typeof payRunSchema>) {
  const run = await loadRun(ctx, id);
  if (run.status !== "APPROVED") throw AppError.badRequest("Approve the payroll before marking it paid", "PAYROLL_NOT_APPROVED");
  const paidAt = input.paidOn ? toDay(input.paidOn) : new Date();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Payslip.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "PAID" }, { session });
      run.set({ status: "PAID", paidAt, paymentReference: input.reference, updatedBy: ctx.userId });
      await run.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.payroll", documentType: "PayrollRun", documentId: run._id, newValue: { status: "PAID", reference: input.reference } });
  return { id, status: "PAID" };
}

/**
 * A draft is simply deleted. An approved run is cancelled with its loan
 * instalments and claim reimbursements reversed, freeing the month for a
 * fresh run. A paid run is final.
 */
export async function cancelRun(ctx: AuthContext, id: string, reason: string) {
  const run = await loadRun(ctx, id);
  if (run.status === "PAID") throw AppError.badRequest("A paid payroll cannot be cancelled", "PAYROLL_PAID");
  if (run.status === "CANCELLED") throw AppError.badRequest("This payroll is already cancelled", "PAYROLL_CANCELLED");

  const session = await mongoose.startSession();
  const wasDraft = run.status === "DRAFT";
  try {
    await session.withTransaction(async () => {
      if (wasDraft) {
        await Payslip.deleteMany({ businessId: ctx.businessId, payrollRunId: run._id }, { session });
        await PayrollRun.deleteOne({ _id: run._id, businessId: ctx.businessId }, { session });
        return;
      }
      const loans = await EmployeeLoan.find({ businessId: ctx.businessId, "repayments.payrollRunId": run._id }).session(session);
      for (const loan of loans) {
        loan.repayments = loan.repayments.filter((r: AnyDoc) => String(r.payrollRunId) !== String(run._id));
        const repaid = loan.repayments.reduce((t: Decimal, r: AnyDoc) => t.plus(d(r.amount)), new Decimal(0));
        loan.repaidAmount = dec128(repaid);
        if (loan.status === "CLOSED" && repaid.lt(d(loan.amount))) loan.status = "ACTIVE";
        loan.updatedBy = ctx.userId;
        await loan.save({ session });
      }
      await ExpenseClaim.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "APPROVED", payrollRunId: null, updatedBy: ctx.userId }, { session });
      await Payslip.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "CANCELLED" }, { session });
      run.set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, updatedBy: ctx.userId });
      await run.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: wasDraft ? "DELETE" : "CANCEL",
    module: "hr.payroll",
    documentType: "PayrollRun",
    documentId: run._id,
    reason,
  });
  return { id, status: wasDraft ? "DELETED" : "CANCELLED" };
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

function runRow(r: AnyDoc) {
  return {
    id: String(r._id),
    runNumber: r.runNumber,
    month: r.month,
    year: r.year,
    period: monthLabel(r.month, r.year),
    status: r.status,
    employeeCount: r.employeeCount,
    totalGross: d(r.totalGross).toFixed(2),
    totalReimbursements: d(r.totalReimbursements).toFixed(2),
    totalDeductions: d(r.totalDeductions).toFixed(2),
    totalNet: d(r.totalNet).toFixed(2),
    totalEmployerContribution: d(r.totalEmployerContribution).toFixed(2),
    approvedAt: r.approvedAt,
    paidAt: r.paidAt,
    paymentReference: r.paymentReference,
    cancelReason: r.cancelReason,
    notes: r.notes,
    createdAt: r.createdAt,
  };
}

export async function listRuns(ctx: AuthContext, params: { status?: string; year?: number; page: number; pageSize: number }) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.status) filter.status = params.status;
  if (params.year) filter.year = params.year;
  const [rows, total] = await Promise.all([
    PayrollRun.find(filter).sort({ year: -1, month: -1, createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    PayrollRun.countDocuments(filter),
  ]);
  return { items: rows.map(runRow), total };
}

function slipRow(s: AnyDoc) {
  const lines = (arr: AnyDoc[]) => (arr ?? []).map((l) => ({ code: l.code, label: l.label, amount: d(l.amount).toFixed(2) }));
  return {
    id: String(s._id),
    payrollRunId: String(s.payrollRunId),
    employeeId: String(s.employeeId),
    month: s.month,
    year: s.year,
    period: monthLabel(s.month, s.year),
    employee: serializeDoc(s.employee),
    daysInMonth: s.daysInMonth,
    payableDays: s.payableDays,
    lopDays: s.lopDays,
    presentDays: s.presentDays,
    paidLeaveDays: s.paidLeaveDays,
    holidays: s.holidays,
    weeklyOffs: s.weeklyOffs,
    earnings: lines(s.earnings),
    deductions: lines(s.deductions),
    employerContributions: lines(s.employerContributions),
    pfWages: d(s.pfWages).toFixed(2),
    esiWages: d(s.esiWages).toFixed(2),
    grossEarnings: d(s.grossEarnings).toFixed(2),
    reimbursements: d(s.reimbursements).toFixed(2),
    totalDeductions: d(s.totalDeductions).toFixed(2),
    netPay: d(s.netPay).toFixed(2),
    netPayInWords: amountInWords(d(s.netPay).toFixed(2)),
    status: s.status,
  };
}

export async function getRun(ctx: AuthContext, id: string) {
  const run = await loadRun(ctx, id);
  const slips = await Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).sort({ "employee.code": 1 }).lean<AnyDoc[]>();
  return { run: runRow(run.toObject()), payslips: slips.map(slipRow) };
}

/** A payslip with the business letterhead; through self-service only your own, and only once approved. */
export async function getPayslip(ctx: AuthContext, id: string, opts: { self: boolean }) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Payslip not found");
  const slip = await Payslip.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!slip) throw AppError.notFound("Payslip not found");
  if (opts.self) {
    const emp = await selfEmployee(ctx);
    if (String(slip.employeeId) !== String(emp._id) || !["APPROVED", "PAID"].includes(slip.status)) throw AppError.notFound("Payslip not found");
  }
  const business = await Business.findById(ctx.businessId, { legalName: 1, tradeName: 1, address: 1, city: 1, state: 1, logoUrl: 1 }).lean<AnyDoc>();
  return {
    ...slipRow(slip),
    business: { name: business?.legalName ?? "", tradeName: business?.tradeName ?? "", address: [business?.address, business?.city, business?.state].filter(Boolean).join(", "), logoUrl: business?.logoUrl ?? null },
  };
}

/** The signed-in employee's approved and paid payslips. */
export async function myPayslips(ctx: AuthContext) {
  const emp = await selfEmployee(ctx);
  const slips = await Payslip.find({ businessId: ctx.businessId, employeeId: emp._id, status: { $in: ["APPROVED", "PAID"] } })
    .sort({ year: -1, month: -1 })
    .limit(36)
    .lean<AnyDoc[]>();
  return { items: slips.map((s) => ({ id: String(s._id), period: monthLabel(s.month, s.year), month: s.month, year: s.year, grossEarnings: d(s.grossEarnings).toFixed(2), totalDeductions: d(s.totalDeductions).toFixed(2), netPay: d(s.netPay).toFixed(2), status: s.status })) };
}

/** Payslips for one employee (HR view on the profile). */
export async function employeePayslips(ctx: AuthContext, employeeId: Types.ObjectId) {
  const slips = await Payslip.find({ businessId: ctx.businessId, employeeId, status: { $ne: "CANCELLED" } }).sort({ year: -1, month: -1 }).limit(24).lean<AnyDoc[]>();
  return slips.map((s) => ({ id: String(s._id), payrollRunId: String(s.payrollRunId), period: monthLabel(s.month, s.year), netPay: d(s.netPay).toFixed(2), status: s.status }));
}

/** Employees missing what payroll needs (no salary, no bank details), shown before running payroll. */
export async function payrollReadiness(ctx: AuthContext, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const emps = await employeesDuring(ctx.businessId, start, end);
  const noSalary = emps.filter((e) => d(e.basic).plus(d(e.hra)).plus(d(e.specialAllowance)).plus(d(e.conveyance)).plus(d(e.otherAllowance)).lte(0));
  const noBank = emps.filter((e) => (e.salaryPaymentMode ?? "BANK") === "BANK" && (!e.bankAccountNumber || !e.ifscCode));
  const pendingLeaves = await mongoose.model("LeaveApplication").countDocuments({ businessId: ctx.businessId, status: "PENDING", fromDate: { $lte: end }, toDate: { $gte: start } });
  return {
    employees: emps.length,
    noSalary: noSalary.map((e) => ({ id: String(e._id), code: e.employeeCode, name: e.name })),
    noBank: noBank.map((e) => ({ id: String(e._id), code: e.employeeCode, name: e.name })),
    pendingLeaves,
    totalEmployees: await Employee.countDocuments({ businessId: ctx.businessId, deletedAt: null }),
  };
}

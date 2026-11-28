import mongoose, { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Attendance, PayrollRun, Payslip, EmployeeLoan, ExpenseClaim, Employee, PayrollHold, LeaveApplication } from "@/models/hr";
import { Business } from "@/models/Business";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { serializeDoc } from "@/lib/resources/serialize";
import { amountInWords } from "@/lib/documents/numberToWords";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, eachDay, monthRange, loadCalendar } from "./calendar";
import { payrollEmployees } from "./holds";
import { monthVariables, variableKey } from "./variables";
import { summarizeMonth, type AttendanceRow, type MonthSummary } from "./attendance";
import { computePayslip } from "./payrollMath";
import { statutoryRules, getPayrollSettings } from "./payrollSettings";
import { approvalGate, cancelApproval, approvalFingerprint } from "@/lib/approvals/service";
import { applyDueChanges, salaryForMonth } from "./history";
import { postPayrollAccrual, postPayrollPayment, reversePayrollAccrual } from "./payrollPosting";
import { pendingArrearLines, settleArrears, reopenArrears } from "./arrears";
import type { PayslipPrintData } from "./payslipPdf";
import { nextHrNumber, employeeLabels, selfEmployee, monthQuery, type AnyDoc } from "./common";

export const createRunSchema = monthQuery.extend({ notes: z.string().trim().max(500).optional().default("") });
export const payRunSchema = z.object({
  paidOn: z.string().trim().optional(),
  reference: z.string().trim().max(100).optional().default(""),
});
export const approveRunSchema = z.object({
  /** Approve even though some working days have no attendance, paying them as present. Recorded in the audit log. */
  payUnmarkedAsPresent: z.boolean().optional().default(false),
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

/** Each employee's attendance rows for the month, keyed by day — the same input the register and payroll read. */
async function monthAttendance(businessId: Types.ObjectId, ids: Types.ObjectId[], start: Date, end: Date, session?: ClientSession) {
  const query = Attendance.find({ businessId, employeeId: { $in: ids }, date: { $gte: start, $lte: end } });
  const rows = await (session ? query.session(session) : query).lean<AnyDoc[]>();
  const by = new Map<string, Map<string, AttendanceRow>>();
  for (const a of rows) {
    const k = String(a.employeeId);
    if (!by.has(k)) by.set(k, new Map());
    by.get(k)!.set(dayKey(toDay(a.date)), a);
  }
  return by;
}

/** Live month summary for every employee on the rolls, keyed by employee id. */
async function liveSummaries(businessId: Types.ObjectId, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const days = eachDay(start, end);
  const emps = await payrollEmployees(businessId, year, month);
  const [cal, attendanceBy] = await Promise.all([
    loadCalendar(businessId, start, end),
    monthAttendance(businessId, emps.map((e) => e._id), start, end),
  ]);
  const out = new Map<string, { emp: AnyDoc; summary: MonthSummary }>();
  for (const e of emps) {
    out.set(String(e._id), { emp: e, summary: summarizeMonth(e, cal, days, attendanceBy.get(String(e._id)) ?? new Map()).summary });
  }
  return out;
}

/**
 * Builds every payslip for a run inside the caller's transaction: who was on
 * the rolls that month, their attendance (loss-of-pay days), salary
 * structure, active loan instalments and approved claims awaiting payment.
 */
async function generatePayslips(ctx: AuthContext, run: AnyDoc, session: ClientSession) {
  const { start, end, days: daysInMonth } = monthRange(run.year, run.month);
  const days = eachDay(start, end);
  // Employees whose salary is on hold this month are left out.
  const emps = await payrollEmployees(ctx.businessId, run.year, run.month, session);
  if (emps.length === 0) throw AppError.badRequest(`No employees to pay in ${monthLabel(run.month, run.year)} (none on the rolls, or all on hold).`, "NO_EMPLOYEES");
  const ids = emps.map((e) => e._id);

  // Payroll Settings: hold the month back while a PF-deducted employee has no UAN / PF number.
  const [settings, rules] = await Promise.all([getPayrollSettings(ctx.businessId), statutoryRules(ctx.businessId)]);
  if (settings.restrictIfPfAccountMissing && rules.pfEnabled) {
    const missing = emps.filter((e) => e.pfApplicable !== false && !String(e.uanNumber ?? "").trim() && !String(e.pfNumber ?? "").trim());
    if (missing.length > 0) {
      const names = missing.slice(0, 5).map((e) => `${e.name} (${e.employeeCode})`).join(", ");
      throw AppError.badRequest(
        `${missing.length} employee${missing.length === 1 ? " has" : "s have"} PF deducted but no UAN or PF account number: ${names}${missing.length > 5 ? "…" : ""}. Add the numbers, or untick PF for them, or turn off the restriction in Payroll Settings.`,
        "PF_ACCOUNT_MISSING"
      );
    }
  }

  const [cal, attendanceBy, loans, claims, labels, salaries, variables] = await Promise.all([
    loadCalendar(ctx.businessId, start, end),
    monthAttendance(ctx.businessId, ids, start, end, session),
    EmployeeLoan.find({
      businessId: ctx.businessId,
      employeeId: { $in: ids },
      status: "ACTIVE",
      $or: [{ startYear: { $lt: run.year } }, { startYear: run.year, startMonth: { $lte: run.month } }],
    })
      .sort({ issueDate: 1 })
      .session(session)
      .lean<AnyDoc[]>(),
    // Approved claims go into the next payroll, or the one HR chose on Claim Settlement (and any after it, if that month was missed).
    ExpenseClaim.find({
      businessId: ctx.businessId,
      employeeId: { $in: ids },
      status: "APPROVED",
      payrollRunId: null,
      claimDate: { $lte: end },
      $or: [{ payInYear: null }, { payInYear: { $exists: false } }, { payInYear: { $lt: run.year } }, { payInYear: run.year, payInMonth: { $lte: run.month } }],
    })
      .session(session)
      .lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, ids),
    salaryForMonth(ctx.businessId, emps, start, end, session),
    monthVariables(ctx.businessId, run.year, run.month, ids, session),
  ]);
  const arrears = await pendingArrearLines(ctx.businessId, ids, session);

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
    // The salary in effect during the month (day-weighted if it was revised mid-month).
    const salary = salaries.get(key)!;
    const result = computePayslip({
      structure: {
        basic: salary.basic,
        hra: salary.hra,
        conveyance: salary.conveyance,
        specialAllowance: salary.specialAllowance,
        otherAllowance: salary.otherAllowance,
        pfApplicable: salary.pfApplicable,
        esiApplicable: salary.esiApplicable,
        ptApplicable: salary.ptApplicable,
        professionalTax: salary.professionalTax,
        monthlyTds: salary.monthlyTds,
      },
      daysInMonth,
      lopDays: summary.lopDays,
      rules,
      month: run.month,
      loans: myLoans.map((l) => ({ loanId: String(l._id), emi: d(l.emiAmount), outstanding: d(l.amount).minus(d(l.repaidAmount)) })),
      reimbursements: myClaims.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0)),
      // Variable pay for the month plus any arrears owed for approved months.
      variables: [...(variables.get(key) ?? []), ...(arrears.get(key)?.lines ?? [])],
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
      unmarkedDays: summary.unmarked,
      variableKey: variableKey([...(variables.get(key) ?? []), ...(arrears.get(key)?.lines ?? [])]),
      arrearIds: arrears.get(key)?.ids ?? [],
      structure: {
        basic: dec128(salary.basic),
        hra: dec128(salary.hra),
        conveyance: dec128(salary.conveyance),
        specialAllowance: dec128(salary.specialAllowance),
        otherAllowance: dec128(salary.otherAllowance),
        revisedOn: salary.revisedOn,
      },
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
  await applyDueChanges(ctx.businessId);
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
  await applyDueChanges(ctx.businessId);
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
/** What a payroll approver signs off: the month, headcount and totals. Recalculating to different figures restarts approval. */
function payrollApprovalRecord(run: AnyDoc) {
  return {
    id: run._id,
    number: run.runNumber,
    summary: `${monthLabel(run.month, run.year)} · ${run.employeeCount} employee(s)`,
    amount: d(run.totalNet).toFixed(2),
    requestedByUserId: run.createdBy ?? null,
    fingerprint: approvalFingerprint([run.year, run.month, run.employeeCount, d(run.totalGross).toFixed(2), d(run.totalDeductions).toFixed(2), d(run.totalNet).toFixed(2), d(run.totalEmployerContribution).toFixed(2)]),
  };
}

/** Rejection from the approval queue: the run stays a draft for HR to correct, recalculate or delete. */
export async function rejectRunApproval(ctx: AuthContext, id: string, note: string) {
  const run = await loadRun(ctx, id);
  if (run.status !== "DRAFT") throw AppError.badRequest(`This payroll is already ${run.status.toLowerCase()}`, "PAYROLL_NOT_DRAFT");
  await approvalGate(ctx, "hr-payroll", payrollApprovalRecord(run), "reject", note);
  return { id, status: "DRAFT" };
}

/** Payroll Settings → "Restrict salary if leaves are pending": refuses approval while leave in the month awaits a decision. */
async function assertNoPendingLeave(ctx: AuthContext, run: AnyDoc) {
  const settings = await getPayrollSettings(ctx.businessId);
  if (!settings.restrictIfLeavesPending) return;
  const { start, end } = monthRange(run.year, run.month);
  const pending = await LeaveApplication.countDocuments({ businessId: ctx.businessId, status: "PENDING", fromDate: { $lte: end }, toDate: { $gte: start } });
  if (pending > 0) {
    throw AppError.badRequest(
      `${pending} leave request${pending === 1 ? " is" : "s are"} still pending for ${monthLabel(run.month, run.year)}. Approve or reject ${pending === 1 ? "it" : "them"} first (or turn off the restriction in Payroll Settings).`,
      "LEAVES_PENDING"
    );
  }
}

export async function approveRun(ctx: AuthContext, id: string, input: { payUnmarkedAsPresent?: boolean } = {}) {
  const run = await loadRun(ctx, id);
  if (run.status !== "DRAFT") throw AppError.badRequest(`This payroll is already ${run.status.toLowerCase()}`, "PAYROLL_NOT_DRAFT");
  const slips = await Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).lean<AnyDoc[]>();
  if (slips.length === 0) throw AppError.badRequest("This payroll has no payslips", "PAYROLL_EMPTY");
  const { unmarkedDays, unmarkedEmployees } = await assertAttendanceSettled(ctx, run, slips, input.payUnmarkedAsPresent === true);
  await assertNoPendingLeave(ctx, run);
  // Approval scheme: only the last stage's approval locks the month and posts the payroll.
  const gate = await approvalGate(ctx, "hr-payroll", payrollApprovalRecord(run), "approve");
  if (!gate.proceed) return { id, status: "DRAFT", unmarkedDaysPaid: 0, approvalMessage: gate.message };

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
            { status: "REIMBURSED", payrollRunId: run._id, settlementMode: "PAYROLL", settledAt: new Date(Date.UTC(run.year, run.month - 1, 1)), settlementReference: run.runNumber, updatedBy: ctx.userId },
            { session }
          );
        }
      }
      await Payslip.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "APPROVED" }, { session });
      await settleArrears(ctx.businessId, slips.flatMap((s) => s.arrearIds ?? []), run._id, session);
      run.set({ status: "APPROVED", approvedByUserId: ctx.userId, approvedAt: new Date(), unmarkedDaysPaid: unmarkedDays, updatedBy: ctx.userId });
      await run.save({ session });
      // ERP workspaces: the month's salary cost goes to the general ledger with the approval.
      await postPayrollAccrual(ctx, run, slips, session);
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.payroll",
    documentType: "PayrollRun",
    documentId: run._id,
    newValue: { status: "APPROVED", ...(unmarkedDays > 0 ? { unmarkedDaysPaidAsPresent: unmarkedDays, unmarkedEmployees } : {}) },
    ...(unmarkedDays > 0 ? { reason: `Approved with ${unmarkedDays} unmarked working day(s) for ${unmarkedEmployees} employee(s) paid as present` } : {}),
  });
  return { id, status: "APPROVED", unmarkedDaysPaid: unmarkedDays };
}

/**
 * Re-reads the month's attendance before approval. Refuses when the payslips
 * no longer match it (attendance, leave or the employee list changed after the
 * draft was calculated), and refuses unmarked working days unless the
 * approver explicitly chose to pay them as present.
 */
async function assertAttendanceSettled(ctx: AuthContext, run: AnyDoc, slips: AnyDoc[], payUnmarkedAsPresent: boolean) {
  const live = await liveSummaries(ctx.businessId, run.year, run.month);
  const slipBy = new Map(slips.map((s) => [String(s.employeeId), s]));

  const changed: string[] = [];
  for (const [key, { emp, summary }] of live) {
    const slip = slipBy.get(key);
    // Payslips made before unmarked days were stored have no count to compare; their LOP days still are.
    if (!slip || slip.lopDays !== summary.lopDays || (slip.unmarkedDays !== undefined && slip.unmarkedDays !== summary.unmarked)) {
      changed.push(emp.name);
    }
  }
  for (const s of slips) if (!live.has(String(s.employeeId))) changed.push(s.employee?.name ?? "an employee");
  // Variable pay entered or edited after the draft was calculated.
  const liveIds = [...live.values()].map((v) => v.emp._id);
  const [vars, arrears] = await Promise.all([monthVariables(ctx.businessId, run.year, run.month, liveIds), pendingArrearLines(ctx.businessId, liveIds)]);
  for (const [key, { emp }] of live) {
    const slip = slipBy.get(key);
    const nowKey = variableKey([...(vars.get(key) ?? []), ...(arrears.get(key)?.lines ?? [])]);
    if (slip && slip.variableKey !== undefined && slip.variableKey !== nowKey && !changed.includes(emp.name)) changed.push(emp.name);
  }
  if (changed.length > 0) {
    const names = `${changed.slice(0, 5).join(", ")}${changed.length > 5 ? "…" : ""}`;
    throw new AppError(`Attendance, holds or variable pay changed after this payroll was calculated (${names}). Recalculate it before approving.`, 409, "PAYROLL_STALE", changed);
  }

  const unmarked = [...live.values()].filter(({ summary }) => summary.unmarked > 0);
  const unmarkedDays = unmarked.reduce((t, { summary }) => t + summary.unmarked, 0);
  if (unmarkedDays > 0 && !payUnmarkedAsPresent) {
    throw AppError.badRequest(
      `${unmarkedDays} working day(s) for ${unmarked.length} employee(s) have no attendance in ${monthLabel(run.month, run.year)}. Mark attendance and recalculate, or approve paying those days as present.`,
      "UNMARKED_ATTENDANCE",
      unmarked.map(({ emp, summary }) => ({ id: String(emp._id), code: emp.employeeCode, name: emp.name, days: summary.unmarked }))
    );
  }
  return { unmarkedDays, unmarkedEmployees: unmarked.length };
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
      const slips = await Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).session(session).lean<AnyDoc[]>();
      await postPayrollPayment(ctx, run, slips, session);
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
      await ExpenseClaim.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "APPROVED", payrollRunId: null, settlementMode: null, settledAt: null, settlementReference: "", updatedBy: ctx.userId }, { session });
      await Payslip.updateMany({ businessId: ctx.businessId, payrollRunId: run._id }, { status: "CANCELLED" }, { session });
      run.set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason, updatedBy: ctx.userId });
      await run.save({ session });
      await reversePayrollAccrual(ctx, run, reason, session);
      await reopenArrears(ctx.businessId, run._id, session);
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
  // A deleted draft can no longer be approved: close its open approval.
  if (wasDraft) await cancelApproval(ctx.businessId, "hr-payroll", run._id);
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
    unmarkedDaysPaid: r.unmarkedDaysPaid ?? 0,
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
    employee: serializeDoc(s.employee) as PayslipPrintData["employee"],
    daysInMonth: s.daysInMonth,
    payableDays: s.payableDays,
    lopDays: s.lopDays,
    presentDays: s.presentDays,
    paidLeaveDays: s.paidLeaveDays,
    holidays: s.holidays,
    weeklyOffs: s.weeklyOffs,
    unmarkedDays: s.unmarkedDays ?? 0,
    salaryRevisedOn: (s.structure?.revisedOn ?? []).map((x: Date) => dayKey(toDay(x))),
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
  return { run: runRow(run.toObject()), payslips: slips.map(slipRow), onHold: await heldList(ctx.businessId, run.year, run.month) };
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
  return { ...slipRow(slip), business: await payslipLetterhead(ctx.businessId) };
}

/** Business name and address printed at the top of every payslip. */
async function payslipLetterhead(businessId: Types.ObjectId) {
  const business = await Business.findById(businessId, { legalName: 1, tradeName: 1, address: 1, city: 1, state: 1, logoUrl: 1 }).lean<AnyDoc>();
  return {
    name: business?.legalName ?? "",
    tradeName: business?.tradeName ?? "",
    address: [business?.address, business?.city, business?.state].filter(Boolean).join(", "),
    logoUrl: business?.logoUrl ?? null,
  };
}

/** Every payslip of a run with the letterhead, in employee-code order, for the combined PDF. */
export async function runPayslipsForPrint(ctx: AuthContext, id: string) {
  const run = await loadRun(ctx, id);
  if (run.status === "CANCELLED") throw AppError.badRequest("This payroll is cancelled", "PAYROLL_CANCELLED");
  const [slips, business] = await Promise.all([
    Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).sort({ "employee.code": 1 }).lean<AnyDoc[]>(),
    payslipLetterhead(ctx.businessId),
  ]);
  return { period: monthLabel(run.month, run.year), runNumber: run.runNumber as string, slips: slips.map((s) => ({ ...slipRow(s), business })) };
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

/** Employees whose salary is on hold for the month (left out of its payroll). */
async function heldList(businessId: Types.ObjectId, year: number, month: number) {
  const holds = await PayrollHold.find({ businessId, year, month }).lean<AnyDoc[]>();
  const labels = await employeeLabels(businessId, holds.map((h) => h.employeeId));
  return holds.map((h) => ({ id: String(h.employeeId), name: labels.get(String(h.employeeId))?.name ?? "—", code: labels.get(String(h.employeeId))?.code ?? "", reason: h.reason as string }));
}

/** Payslips for one employee (HR view on the profile). */
export async function employeePayslips(ctx: AuthContext, employeeId: Types.ObjectId) {
  const slips = await Payslip.find({ businessId: ctx.businessId, employeeId, status: { $ne: "CANCELLED" } }).sort({ year: -1, month: -1 }).limit(24).lean<AnyDoc[]>();
  return slips.map((s) => ({ id: String(s._id), payrollRunId: String(s.payrollRunId), period: monthLabel(s.month, s.year), netPay: d(s.netPay).toFixed(2), status: s.status }));
}

/** What would make a month's payroll wrong — no salary, no bank details, pending leave, unmarked attendance — shown before running it. */
export async function payrollReadiness(ctx: AuthContext, year: number, month: number) {
  const { start, end } = monthRange(year, month);
  const live = await liveSummaries(ctx.businessId, year, month);
  const emps = [...live.values()].map((v) => v.emp);
  const unmarked = [...live.values()].filter(({ summary }) => summary.unmarked > 0);
  const noSalary = emps.filter((e) => d(e.basic).plus(d(e.hra)).plus(d(e.specialAllowance)).plus(d(e.conveyance)).plus(d(e.otherAllowance)).lte(0));
  const noBank = emps.filter((e) => (e.salaryPaymentMode ?? "BANK") === "BANK" && (!e.bankAccountNumber || !e.ifscCode));
  const pendingLeaves = await mongoose.model("LeaveApplication").countDocuments({ businessId: ctx.businessId, status: "PENDING", fromDate: { $lte: end }, toDate: { $gte: start } });
  return {
    employees: emps.length,
    noSalary: noSalary.map((e) => ({ id: String(e._id), code: e.employeeCode, name: e.name })),
    noBank: noBank.map((e) => ({ id: String(e._id), code: e.employeeCode, name: e.name })),
    pendingLeaves,
    unmarked: unmarked.map(({ emp, summary }) => ({ id: String(emp._id), code: emp.employeeCode, name: emp.name, days: summary.unmarked })),
    unmarkedDays: unmarked.reduce((t, { summary }) => t + summary.unmarked, 0),
    blocked: await heldList(ctx.businessId, year, month),
    totalEmployees: await Employee.countDocuments({ businessId: ctx.businessId, deletedAt: null }),
  };
}

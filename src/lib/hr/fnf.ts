import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Attendance, Employee, EmployeeLoan, FnfSettlement, HrAsset, LeaveType, Payslip, PayrollArrear, SEPARATION_TYPES, NOTICE_TREATMENTS } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey, eachDay, monthRange, loadCalendar, employedDuringFilter } from "./calendar";
import { summarizeMonth, type AttendanceRow } from "./attendance";
import { computePayslip } from "./payrollMath";
import { salaryForMonth, stateOn } from "./history";
import { balancesFor } from "./leave";
import { pendingArrearLines } from "./arrears";
import { nextHrNumber, findEmployee, employeeLabels, objectId, type AnyDoc } from "./common";

/*
 * Gratuity and full & final settlement.
 *
 * Gratuity (Payment of Gratuity Act, 1972, covered establishments):
 *   last drawn basic × 15/26 × completed years of service, where a final
 *   part-year of more than six months counts as a year; payable after five
 *   years of continuous service (not required on death); capped at ₹20 lakh.
 *   The rates are constants here and must be validated before relying on them.
 *
 * F&F: salary for the months not yet paid up to the last working day (from
 * attendance and the salary history, with PF/ESI/PT/TDS), leave encashment,
 * gratuity, pending arrears and notice pay, less notice recovery and
 * outstanding loans; HR can add lines. DRAFT → APPROVED → PAID.
 */

export const GRATUITY_RULES = {
  minYears: 5,
  daysPerYear: 15,
  divisor: 26,
  ceiling: new Decimal("2000000"),
};
/** Daily rate for leave encashment and notice pay: monthly amount ÷ 30. */
const DAYS_PER_MONTH = 30;

const d = (v: unknown) => new Decimal(v === null || v === undefined || v === "" ? "0" : String(v));
const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const ym = (y: number, m: number) => y * 12 + (m - 1);

/** Years, months and days from joining to the last day of service (inclusive). */
export function serviceBetween(joined: Date, until: Date): { years: number; months: number; days: number } {
  const a = toDay(joined);
  const b = new Date(toDay(until).getTime() + 86_400_000); // inclusive of the last day
  let years = b.getUTCFullYear() - a.getUTCFullYear();
  let months = b.getUTCMonth() - a.getUTCMonth();
  let days = b.getUTCDate() - a.getUTCDate();
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

export function serviceText(s: { years: number; months: number; days: number }): string {
  return `${s.years} yr ${s.months} mo ${s.days} d`;
}

/** Gratuity for a period of service and the last drawn basic. */
export function gratuityFor(input: { joined: Date; until: Date; basic: Decimal.Value; waiveMinimum?: boolean }) {
  const s = serviceBetween(input.joined, input.until);
  const extra = s.months > 6 || (s.months === 6 && s.days > 0);
  const completedYears = s.years + (extra ? 1 : 0);
  const eligible = input.waiveMinimum === true || s.years >= GRATUITY_RULES.minYears;
  const formula = money(new Decimal(input.basic || 0).times(GRATUITY_RULES.daysPerYear).dividedBy(GRATUITY_RULES.divisor).times(completedYears));
  const accrued = Decimal.min(formula, GRATUITY_RULES.ceiling);
  return { service: serviceText(s), completedYears, eligible, accrued, payable: eligible ? accrued : new Decimal(0), capped: formula.gt(GRATUITY_RULES.ceiling) };
}

/** Gratuity owed to everyone on the rolls on a date: accrued (for provisioning) and payable if they left that day. */
export async function gratuityReport(ctx: AuthContext, asOfText: string) {
  const asOf = toDay(asOfText);
  const emps = await Employee.find(employedDuringFilter(ctx.businessId, asOf, asOf)).sort({ employeeCode: 1 }).lean<AnyDoc[]>();
  const labels = await employeeLabels(ctx.businessId, emps.map((e) => e._id));
  const rows = [];
  let accrued = new Decimal(0);
  let payable = new Decimal(0);
  for (const e of emps) {
    const state = await stateOn(ctx.businessId, e, asOf);
    const basic = d(state.basic);
    const g = gratuityFor({ joined: e.dateOfJoining, until: asOf, basic });
    accrued = accrued.plus(g.accrued);
    payable = payable.plus(g.payable);
    rows.push({
      employeeId: String(e._id),
      employeeCode: e.employeeCode,
      name: e.name,
      department: labels.get(String(e._id))?.department ?? "",
      dateOfJoining: dayKey(toDay(e.dateOfJoining)),
      service: g.service,
      completedYears: g.completedYears,
      basic: basic.toFixed(2),
      eligible: g.eligible,
      accrued: g.accrued.toFixed(2),
      payable: g.payable.toFixed(2),
      capped: g.capped,
    });
  }
  return { asOf: dayKey(asOf), rules: { minYears: GRATUITY_RULES.minYears, formula: "Basic × 15 / 26 × completed years", ceiling: GRATUITY_RULES.ceiling.toFixed(0) }, rows, totals: { accrued: accrued.toFixed(2), payable: payable.toFixed(2) } };
}

/* ------------------------------------------------------------------ */
/* Full & final: calculation                                           */
/* ------------------------------------------------------------------ */

const date = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date");
const amount = z.union([z.string(), z.number()]).transform((v) => String(v).trim().replace(/,/g, "")).refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Enter an amount");
const manualLine = z.object({ kind: z.enum(["EARNING", "DEDUCTION"]), label: z.string().trim().min(2).max(80), amount });

export const createFnfSchema = z.object({
  employeeId: objectId,
  separationType: z.enum(SEPARATION_TYPES),
  resignationDate: date.optional().or(z.literal("")),
  lastWorkingDay: date,
  noticeDays: z.coerce.number().int().min(0).max(365).default(30),
  noticeTreatment: z.enum(NOTICE_TREATMENTS).optional(),
  exitReason: z.string().trim().max(300).optional().default(""),
  notes: z.string().trim().max(1000).optional().default(""),
});

export const updateFnfSchema = z.object({
  noticeDays: z.coerce.number().int().min(0).max(365).optional(),
  noticeTreatment: z.enum(NOTICE_TREATMENTS).optional(),
  manualLines: z.array(manualLine).max(30).optional(),
  notes: z.string().trim().max(1000).optional(),
});

interface Line {
  code: string;
  label: string;
  amount: Decimal;
  note?: string;
  manual?: boolean;
}

interface FnfInput {
  separationType: (typeof SEPARATION_TYPES)[number];
  resignationDate: Date | null;
  lastWorkingDay: Date;
  noticeDays: number;
  noticeTreatment: (typeof NOTICE_TREATMENTS)[number];
  manualLines: { kind: "EARNING" | "DEDUCTION"; label: string; amount: string }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUTORY_LABEL: Record<string, string> = { PF: "Provident fund", ESI: "ESI", PT: "Professional tax", TDS: "Income tax (TDS)" };

/** Works out every line of a settlement from today's data. */
async function calculate(ctx: AuthContext, emp: AnyDoc, input: FnfInput) {
  const lwd = toDay(input.lastWorkingDay);
  const earnings: Line[] = [];
  const deductions: Line[] = [];

  // 1. Salary for months after the last approved payroll, up to the last working day.
  const lastPaid = await Payslip.findOne({ businessId: ctx.businessId, employeeId: emp._id, status: { $in: ["APPROVED", "PAID"] } }).sort({ year: -1, month: -1 }).lean<AnyDoc>();
  const joined = toDay(emp.dateOfJoining);
  let fromY = lastPaid ? (lastPaid.month === 12 ? lastPaid.year + 1 : lastPaid.year) : joined.getUTCFullYear();
  let fromM = lastPaid ? (lastPaid.month === 12 ? 1 : lastPaid.month + 1) : joined.getUTCMonth() + 1;
  if (ym(fromY, fromM) < ym(joined.getUTCFullYear(), joined.getUTCMonth() + 1)) {
    fromY = joined.getUTCFullYear();
    fromM = joined.getUTCMonth() + 1;
  }
  const leaving = { ...emp, dateOfExit: lwd };
  const months: string[] = [];
  const earnBy = new Map<string, Line>();
  const dedBy = new Map<string, Line>();
  let unmarked = 0;
  for (let y = fromY, m = fromM; ym(y, m) <= ym(lwd.getUTCFullYear(), lwd.getUTCMonth() + 1); m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
    const { start, end } = monthRange(y, m);
    const days = eachDay(start, end);
    const [cal, rows, salaries] = await Promise.all([
      loadCalendar(ctx.businessId, start, end),
      Attendance.find({ businessId: ctx.businessId, employeeId: emp._id, date: { $gte: start, $lte: end } }).lean<AnyDoc[]>(),
      salaryForMonth(ctx.businessId, [emp], start, end),
    ]);
    const records = new Map<string, AttendanceRow>(rows.map((r) => [dayKey(toDay(r.date)), r]));
    const { summary } = summarizeMonth(leaving, cal, days, records);
    unmarked += summary.unmarked;
    const s = salaries.get(String(emp._id))!;
    const slip = computePayslip({ structure: s, daysInMonth: days.length, lopDays: summary.lopDays, loans: [], reimbursements: "0" });
    months.push(`${MONTHS[m - 1]} ${y} (${slip.payableDays} days)`);
    for (const l of slip.earnings) {
      const cur = earnBy.get(l.code) ?? { code: l.code, label: l.label, amount: new Decimal(0) };
      cur.amount = cur.amount.plus(l.amount);
      earnBy.set(l.code, cur);
    }
    for (const l of slip.deductions) {
      const cur = dedBy.get(l.code) ?? { code: l.code, label: STATUTORY_LABEL[l.code] ?? l.label, amount: new Decimal(0) };
      cur.amount = cur.amount.plus(l.amount);
      dedBy.set(l.code, cur);
    }
  }
  const salaryNote = months.length > 0 ? `Salary for ${months.join(", ")}${unmarked ? `; ${unmarked} unmarked day(s) paid as present` : ""}` : "";
  for (const l of earnBy.values()) earnings.push({ ...l, note: salaryNote });
  for (const l of dedBy.values()) deductions.push(l);

  // 2. Leave encashment: unused days of encashable leave types × basic ÷ 30.
  const state = await stateOn(ctx.businessId, emp, lwd);
  const basic = d(state.basic);
  const fixedGross = ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance"].reduce((t, f) => t.plus(d((state as AnyDoc)[f])), new Decimal(0));
  const encashable = await LeaveType.find({ businessId: ctx.businessId, deletedAt: null, encashable: true }, { _id: 1 }).lean<AnyDoc[]>();
  const encashIds = new Set(encashable.map((t) => String(t._id)));
  const balances = (await balancesFor(ctx.businessId, [emp._id], lwd.getUTCFullYear())).get(String(emp._id)) ?? [];
  const encashDays = balances.filter((b) => encashIds.has(b.leaveTypeId) && b.available > 0).reduce((t, b) => t + b.available, 0);
  const ratePerDay = money(basic.dividedBy(DAYS_PER_MONTH));
  if (encashDays > 0) {
    const used = balances.filter((b) => encashIds.has(b.leaveTypeId) && b.available > 0).map((b) => `${b.code} ${b.available}`).join(", ");
    earnings.push({ code: "LEAVE_ENC", label: "Leave encashment", amount: money(ratePerDay.times(encashDays)), note: `${encashDays} day(s) (${used}) × basic ÷ ${DAYS_PER_MONTH}` });
  }

  // 3. Gratuity.
  const g = gratuityFor({ joined: emp.dateOfJoining, until: lwd, basic });
  if (g.payable.gt(0)) {
    earnings.push({ code: "GRATUITY", label: "Gratuity", amount: g.payable, note: `Basic ${basic.toFixed(2)} × 15/26 × ${g.completedYears} year(s)${g.capped ? ", capped at ₹20,00,000" : ""}` });
  }

  // 4. Arrears not yet paid.
  const arrears = (await pendingArrearLines(ctx.businessId, [emp._id])).get(String(emp._id));
  for (const l of arrears?.lines ?? []) earnings.push({ code: l.code, label: l.label, amount: d(l.amount) });

  // 5. Notice period.
  const served = input.resignationDate ? Math.max(0, Math.round((lwd.getTime() - toDay(input.resignationDate).getTime()) / 86_400_000) + 1) : 0;
  const shortfall = Math.max(0, input.noticeDays - served);
  const noticeAmount = money(fixedGross.dividedBy(DAYS_PER_MONTH).times(shortfall));
  if (shortfall > 0 && noticeAmount.gt(0)) {
    const note = `${shortfall} day(s) short of ${input.noticeDays} × monthly gross ÷ ${DAYS_PER_MONTH}`;
    if (input.noticeTreatment === "RECOVER") deductions.push({ code: "NOTICE_RECOVERY", label: "Notice period recovery", amount: noticeAmount, note });
    if (input.noticeTreatment === "PAY") earnings.push({ code: "NOTICE_PAY", label: "Pay in lieu of notice", amount: noticeAmount, note });
  }

  // 6. Outstanding loans and advances.
  const loans = await EmployeeLoan.find({ businessId: ctx.businessId, employeeId: emp._id, status: "ACTIVE" }).lean<AnyDoc[]>();
  const loanRecoveries = loans.map((l) => ({ loanId: l._id, amount: money(d(l.amount).minus(d(l.repaidAmount))) })).filter((l) => l.amount.gt(0));
  const loanTotal = loanRecoveries.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  if (loanTotal.gt(0)) deductions.push({ code: "LOAN", label: "Loan / advance outstanding", amount: loanTotal, note: loans.map((l) => l.loanNumber).join(", ") });

  // 7. Lines added by hand.
  for (const ml of input.manualLines) (ml.kind === "EARNING" ? earnings : deductions).push({ code: "MANUAL", label: ml.label, amount: money(d(ml.amount)), manual: true });

  const assets = await HrAsset.find({ businessId: ctx.businessId, employeeId: emp._id, returnedDate: null, deletedAt: null }, { assetTag: 1, name: 1 }).lean<AnyDoc[]>();
  const totalEarnings = earnings.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  const totalDeductions = deductions.reduce((t, l) => t.plus(l.amount), new Decimal(0));
  return {
    salaryFromYear: fromY,
    salaryFromMonth: fromM,
    noticeServedDays: served,
    noticeShortfallDays: shortfall,
    gratuity: { eligible: g.eligible, completedYears: g.completedYears, service: g.service, basic, amount: g.payable },
    leaveEncashment: { days: encashDays, ratePerDay },
    earnings,
    deductions,
    totalEarnings,
    totalDeductions,
    netPayable: totalEarnings.minus(totalDeductions),
    loanRecoveries,
    arrearIds: arrears?.ids ?? [],
    assetsPending: assets.map((a) => ({ assetTag: a.assetTag, name: a.name })),
  };
}

const storeLine = (l: Line) => ({ code: l.code, label: l.label, amount: toDecimal128(money(l.amount)), note: l.note ?? "", manual: Boolean(l.manual) });

function toDocument(c: Awaited<ReturnType<typeof calculate>>) {
  return {
    salaryFromYear: c.salaryFromYear,
    salaryFromMonth: c.salaryFromMonth,
    noticeServedDays: c.noticeServedDays,
    noticeShortfallDays: c.noticeShortfallDays,
    gratuity: { ...c.gratuity, basic: toDecimal128(c.gratuity.basic), amount: toDecimal128(c.gratuity.amount) },
    leaveEncashment: { days: c.leaveEncashment.days, ratePerDay: toDecimal128(c.leaveEncashment.ratePerDay) },
    earnings: c.earnings.map(storeLine),
    deductions: c.deductions.map(storeLine),
    totalEarnings: toDecimal128(money(c.totalEarnings)),
    totalDeductions: toDecimal128(money(c.totalDeductions)),
    netPayable: toDecimal128(money(c.netPayable)),
    loanRecoveries: c.loanRecoveries.map((l) => ({ loanId: l.loanId, amount: toDecimal128(l.amount) })),
    arrearIds: c.arrearIds,
    assetsPending: c.assetsPending,
  };
}

/** Refuses when payroll after the last working day is already approved (it would pay the same days twice). */
async function assertNoPayrollAfter(businessId: Types.ObjectId, employeeId: Types.ObjectId, lwd: Date) {
  const later = await Payslip.findOne({
    businessId,
    employeeId,
    status: { $in: ["APPROVED", "PAID"] },
    $or: [{ year: { $gt: lwd.getUTCFullYear() } }, { year: lwd.getUTCFullYear(), month: { $gt: lwd.getUTCMonth() + 1 } }],
  }).lean<AnyDoc>();
  if (later) throw AppError.badRequest(`Payroll for ${later.month}/${later.year}, after the last working day, is already approved for this employee. Roll it back first.`, "PAID_AFTER_EXIT");
}

const defaultTreatment = (type: string): FnfInput["noticeTreatment"] => (type === "RESIGNED" ? "RECOVER" : type === "TERMINATED" ? "PAY" : "WAIVE");

/* ------------------------------------------------------------------ */
/* Full & final: workflow                                              */
/* ------------------------------------------------------------------ */

async function loadFnf(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Settlement not found");
  const doc = await FnfSettlement.findOne({ _id: id, businessId: ctx.businessId });
  if (!doc) throw AppError.notFound("Settlement not found");
  return doc;
}

const inputOf = (doc: AnyDoc): FnfInput => ({
  separationType: doc.separationType,
  resignationDate: doc.resignationDate,
  lastWorkingDay: doc.lastWorkingDay,
  noticeDays: doc.noticeDays,
  noticeTreatment: doc.noticeTreatment,
  manualLines: (doc.manualLines ?? []).map((l: AnyDoc) => ({ kind: l.kind, label: l.label, amount: d(l.amount).toFixed(2) })),
});

export async function createFnf(ctx: AuthContext, input: z.infer<typeof createFnfSchema>) {
  const emp = await findEmployee(ctx.businessId, input.employeeId);
  const lwd = toDay(input.lastWorkingDay);
  if (lwd < toDay(emp.dateOfJoining)) throw AppError.badRequest("The last working day is before the joining date.", "BEFORE_JOINING");
  const resignation = input.resignationDate ? toDay(input.resignationDate) : null;
  if (resignation && resignation > lwd) throw AppError.badRequest("The resignation date is after the last working day.", "BAD_DATES");
  if (await FnfSettlement.exists({ businessId: ctx.businessId, employeeId: emp._id, status: { $in: ["DRAFT", "APPROVED", "PAID"] } })) {
    throw AppError.conflict(`${emp.name} already has a full & final settlement.`, "FNF_EXISTS");
  }
  await assertNoPayrollAfter(ctx.businessId, emp._id, lwd);

  const fnfInput: FnfInput = { separationType: input.separationType, resignationDate: resignation, lastWorkingDay: lwd, noticeDays: input.noticeDays, noticeTreatment: input.noticeTreatment ?? defaultTreatment(input.separationType), manualLines: [] };
  const calc = await calculate(ctx, emp, fnfInput);
  const settlementNumber = await nextHrNumber(ctx.businessId, "HR_FNF", "FNF");
  const doc = await FnfSettlement.create({
    businessId: ctx.businessId,
    settlementNumber,
    employeeId: emp._id,
    separationType: input.separationType,
    resignationDate: resignation,
    lastWorkingDay: lwd,
    exitReason: input.exitReason,
    noticeDays: input.noticeDays,
    noticeTreatment: fnfInput.noticeTreatment,
    notes: input.notes,
    ...toDocument(calc),
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.fnf", documentType: "FnfSettlement", documentId: doc._id, newValue: { settlementNumber, employee: emp.employeeCode, lastWorkingDay: dayKey(lwd), net: money(calc.netPayable).toFixed(2) } });
  return { id: String(doc._id), settlementNumber };
}

/** Recalculates a draft from today's data, optionally with new notice terms, manual lines or notes. */
export async function updateFnf(ctx: AuthContext, id: string, input: z.infer<typeof updateFnfSchema>) {
  const doc = await loadFnf(ctx, id);
  if (doc.status !== "DRAFT") throw AppError.badRequest("Only a draft settlement can be changed.", "FNF_NOT_DRAFT");
  if (input.noticeDays !== undefined) doc.noticeDays = input.noticeDays;
  if (input.noticeTreatment) doc.noticeTreatment = input.noticeTreatment;
  if (input.notes !== undefined) doc.notes = input.notes;
  if (input.manualLines) doc.manualLines = input.manualLines.map((l) => ({ kind: l.kind, label: l.label, amount: toDecimal128(money(d(l.amount))) }));
  const emp = await findEmployee(ctx.businessId, doc.employeeId);
  await assertNoPayrollAfter(ctx.businessId, emp._id, toDay(doc.lastWorkingDay));
  doc.set({ ...toDocument(await calculate(ctx, emp, inputOf(doc))), updatedBy: ctx.userId });
  await doc.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.fnf", documentType: "FnfSettlement", documentId: doc._id, newValue: { net: d(doc.netPayable).toFixed(2) }, reason: "Recalculated" });
  return { id, netPayable: d(doc.netPayable).toFixed(2) };
}

/**
 * Approves a draft: outstanding loans are recovered, arrears marked paid and
 * the employee recorded as having left on the last working day, in one
 * transaction. Refuses if the figures moved since the draft was calculated.
 */
export async function approveFnf(ctx: AuthContext, id: string) {
  const doc = await loadFnf(ctx, id);
  if (doc.status !== "DRAFT") throw AppError.badRequest(`This settlement is already ${doc.status.toLowerCase()}`, "FNF_NOT_DRAFT");
  const emp = await findEmployee(ctx.businessId, doc.employeeId);
  const lwd = toDay(doc.lastWorkingDay);
  await assertNoPayrollAfter(ctx.businessId, emp._id, lwd);
  const fresh = await calculate(ctx, emp, inputOf(doc));
  if (money(fresh.netPayable).toFixed(2) !== d(doc.netPayable).toFixed(2)) {
    throw AppError.conflict(`The figures changed since this draft was calculated (net now ${money(fresh.netPayable).toFixed(2)}). Recalculate it before approving.`, "FNF_STALE");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const r of doc.loanRecoveries ?? []) {
        const loan = await EmployeeLoan.findOne({ _id: r.loanId, businessId: ctx.businessId }).session(session);
        if (!loan) continue;
        const repaid = d(loan.repaidAmount).plus(d(r.amount));
        loan.repayments.push({ payrollRunId: null, month: lwd.getUTCMonth() + 1, year: lwd.getUTCFullYear(), amount: r.amount, note: `Full & final ${doc.settlementNumber}`, fnfSettlementId: doc._id });
        loan.repaidAmount = toDecimal128(repaid);
        if (repaid.gte(d(loan.amount))) loan.status = "CLOSED";
        loan.updatedBy = ctx.userId;
        await loan.save({ session });
      }
      if ((doc.arrearIds ?? []).length > 0) {
        await PayrollArrear.updateMany({ businessId: ctx.businessId, _id: { $in: doc.arrearIds }, status: "PENDING" }, { status: "INCLUDED", fnfSettlementId: doc._id }, { session });
      }
      await Employee.updateOne(
        { _id: emp._id, businessId: ctx.businessId },
        { $set: { employmentStatus: doc.separationType, dateOfExit: lwd, ...(doc.exitReason ? { exitReason: doc.exitReason } : {}), updatedBy: ctx.userId } },
        { session }
      );
      doc.set({ status: "APPROVED", approvedByUserId: ctx.userId, approvedAt: new Date(), updatedBy: ctx.userId });
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.fnf", documentType: "FnfSettlement", documentId: doc._id, newValue: { status: "APPROVED", net: d(doc.netPayable).toFixed(2), employeeExit: dayKey(lwd) } });
  return { id, status: "APPROVED" };
}

export const payFnfSchema = z.object({ paidOn: date.optional(), reference: z.string().trim().max(100).optional().default("") });

export async function markFnfPaid(ctx: AuthContext, id: string, input: z.infer<typeof payFnfSchema>) {
  const doc = await loadFnf(ctx, id);
  if (doc.status !== "APPROVED") throw AppError.badRequest("Approve the settlement before marking it paid.", "FNF_NOT_APPROVED");
  doc.set({ status: "PAID", paidAt: input.paidOn ? toDay(input.paidOn) : new Date(), paymentReference: input.reference, updatedBy: ctx.userId });
  await doc.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.fnf", documentType: "FnfSettlement", documentId: doc._id, newValue: { status: "PAID", reference: input.reference } });
  return { id, status: "PAID" };
}

/** A draft is deleted; an approved settlement is cancelled with its loan recoveries and arrears reversed. Paid is final. */
export async function cancelFnf(ctx: AuthContext, id: string, reason: string) {
  const doc = await loadFnf(ctx, id);
  if (doc.status === "PAID") throw AppError.badRequest("A paid settlement can't be cancelled.", "FNF_PAID");
  if (doc.status === "CANCELLED") throw AppError.badRequest("This settlement is already cancelled.", "FNF_CANCELLED");
  const wasDraft = doc.status === "DRAFT";
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (wasDraft) {
        await FnfSettlement.deleteOne({ _id: doc._id, businessId: ctx.businessId }, { session });
        return;
      }
      const loans = await EmployeeLoan.find({ businessId: ctx.businessId, "repayments.fnfSettlementId": doc._id }).session(session);
      for (const loan of loans) {
        loan.repayments = loan.repayments.filter((r: AnyDoc) => String(r.fnfSettlementId ?? "") !== String(doc._id));
        const repaid = loan.repayments.reduce((t: Decimal, r: AnyDoc) => t.plus(d(r.amount)), new Decimal(0));
        loan.repaidAmount = toDecimal128(repaid);
        if (loan.status === "CLOSED" && repaid.lt(d(loan.amount))) loan.status = "ACTIVE";
        loan.updatedBy = ctx.userId;
        await loan.save({ session });
      }
      await PayrollArrear.updateMany({ businessId: ctx.businessId, fnfSettlementId: doc._id, status: "INCLUDED" }, { status: "PENDING", fnfSettlementId: null }, { session });
      doc.set({ status: "CANCELLED", cancelReason: reason, updatedBy: ctx.userId });
      await doc.save({ session });
    });
  } finally {
    await session.endSession();
  }
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: wasDraft ? "DELETE" : "CANCEL", module: "hr.fnf", documentType: "FnfSettlement", documentId: doc._id, reason });
  return { id, status: wasDraft ? "DELETED" : "CANCELLED" };
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

const lineOut = (l: AnyDoc) => ({ code: l.code, label: l.label, amount: d(l.amount).toFixed(2), note: l.note ?? "", manual: Boolean(l.manual) });

function row(doc: AnyDoc, label?: { name: string; code: string; department: string }) {
  return {
    id: String(doc._id),
    settlementNumber: doc.settlementNumber,
    employeeId: String(doc.employeeId),
    employeeName: label?.name ?? "—",
    employeeCode: label?.code ?? "",
    department: label?.department ?? "",
    separationType: doc.separationType,
    lastWorkingDay: dayKey(toDay(doc.lastWorkingDay)),
    netPayable: d(doc.netPayable).toFixed(2),
    status: doc.status,
  };
}

export async function listFnf(ctx: AuthContext, status?: string) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (status) filter.status = status;
  const docs = await FnfSettlement.find(filter).sort({ createdAt: -1 }).limit(200).lean<AnyDoc[]>();
  const labels = await employeeLabels(ctx.businessId, docs.map((x) => x.employeeId));
  return { items: docs.map((x) => row(x, labels.get(String(x.employeeId)))) };
}

export async function getFnf(ctx: AuthContext, id: string) {
  const doc = (await loadFnf(ctx, id)).toObject();
  const labels = await employeeLabels(ctx.businessId, [doc.employeeId]);
  const emp = await Employee.findOne({ _id: doc.employeeId, businessId: ctx.businessId }, { dateOfJoining: 1, panNumber: 1, uanNumber: 1, bankName: 1, bankAccountNumber: 1 }).lean<AnyDoc>();
  return {
    ...row(doc, labels.get(String(doc.employeeId))),
    designation: labels.get(String(doc.employeeId))?.designation ?? "",
    dateOfJoining: emp?.dateOfJoining ? dayKey(toDay(emp.dateOfJoining)) : null,
    resignationDate: doc.resignationDate ? dayKey(toDay(doc.resignationDate)) : null,
    exitReason: doc.exitReason,
    noticeDays: doc.noticeDays,
    noticeServedDays: doc.noticeServedDays,
    noticeShortfallDays: doc.noticeShortfallDays,
    noticeTreatment: doc.noticeTreatment,
    salaryFrom: { year: doc.salaryFromYear, month: doc.salaryFromMonth },
    gratuity: { ...doc.gratuity, basic: d(doc.gratuity?.basic).toFixed(2), amount: d(doc.gratuity?.amount).toFixed(2) },
    leaveEncashment: { days: doc.leaveEncashment?.days ?? 0, ratePerDay: d(doc.leaveEncashment?.ratePerDay).toFixed(2) },
    earnings: (doc.earnings ?? []).map(lineOut),
    deductions: (doc.deductions ?? []).map(lineOut),
    manualLines: (doc.manualLines ?? []).map((l: AnyDoc) => ({ kind: l.kind, label: l.label, amount: d(l.amount).toFixed(2) })),
    totalEarnings: d(doc.totalEarnings).toFixed(2),
    totalDeductions: d(doc.totalDeductions).toFixed(2),
    assetsPending: doc.assetsPending ?? [],
    approvedAt: doc.approvedAt,
    paidAt: doc.paidAt,
    paymentReference: doc.paymentReference,
    cancelReason: doc.cancelReason,
    notes: doc.notes,
  };
}

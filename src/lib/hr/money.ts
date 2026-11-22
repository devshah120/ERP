import { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { EmployeeLoan, ExpenseClaim, Employee, CLAIM_CATEGORIES } from "@/models/hr";
import { moneyStringSchema } from "@/lib/validation/money";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { toDay, dayKey } from "./calendar";
import { nextHrNumber, findEmployee, selfEmployee, employeeLabels, objectId, escapeRegex, pageQuery, type AnyDoc } from "./common";

/**
 * Money owed between the business and an employee outside the salary
 * itself: loans / salary advances recovered through payroll, and expense
 * claims reimbursed through payroll.
 */

const d = (v: unknown) => new Decimal(v ? String(v) : "0");
const positive = moneyStringSchema.refine((v) => new Decimal(v).gt(0), "Must be more than zero");

/* ------------------------------------------------------------------ */
/* Loans & advances                                                    */
/* ------------------------------------------------------------------ */

export const loanCreateSchema = z
  .object({
    employeeId: objectId,
    loanType: z.enum(["ADVANCE", "LOAN"]).default("ADVANCE"),
    issueDate: z.string().trim().min(1, "Choose the issue date"),
    amount: positive,
    emiAmount: positive,
    startMonth: z.coerce.number().int().min(1).max(12),
    startYear: z.coerce.number().int().min(2000).max(2100),
    reason: z.string().trim().max(500).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (new Decimal(v.emiAmount).gt(new Decimal(v.amount))) ctx.addIssue({ code: "custom", path: ["emiAmount"], message: "Instalment is more than the loan" });
  });

export const repaymentSchema = z.object({
  amount: positive,
  note: z.string().trim().max(300).optional().default(""),
});

function loanRow(l: AnyDoc, label?: { name: string; code: string; department: string }) {
  const amount = d(l.amount);
  const repaid = d(l.repaidAmount);
  const emi = d(l.emiAmount);
  const outstanding = amount.minus(repaid);
  return {
    id: String(l._id),
    loanNumber: l.loanNumber,
    employeeId: String(l.employeeId),
    employeeName: label?.name ?? "—",
    employeeCode: label?.code ?? "",
    department: label?.department ?? "",
    loanType: l.loanType,
    issueDate: dayKey(toDay(l.issueDate)),
    amount: amount.toFixed(2),
    emiAmount: emi.toFixed(2),
    repaidAmount: repaid.toFixed(2),
    outstanding: outstanding.toFixed(2),
    instalmentsLeft: emi.gt(0) ? outstanding.div(emi).ceil().toNumber() : 0,
    startMonth: l.startMonth,
    startYear: l.startYear,
    status: l.status,
    reason: l.reason,
    repayments: (l.repayments ?? []).map((r: AnyDoc) => ({ month: r.month, year: r.year, amount: d(r.amount).toFixed(2), note: r.note, at: r.at })),
    createdAt: l.createdAt,
  };
}

export async function createLoan(ctx: AuthContext, input: z.infer<typeof loanCreateSchema>) {
  const emp = await findEmployee(ctx.businessId, input.employeeId);
  const loanNumber = await nextHrNumber(ctx.businessId, "HR_LOAN", "LN");
  const loan = await EmployeeLoan.create({
    businessId: ctx.businessId,
    loanNumber,
    employeeId: emp._id,
    loanType: input.loanType,
    issueDate: toDay(input.issueDate),
    amount: toDecimal128(new Decimal(input.amount)),
    emiAmount: toDecimal128(new Decimal(input.emiAmount)),
    startMonth: input.startMonth,
    startYear: input.startYear,
    reason: input.reason,
    status: "ACTIVE",
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.loans", documentType: "EmployeeLoan", documentId: loan._id, newValue: { loanNumber, amount: input.amount } });
  return { id: String(loan._id), loanNumber };
}

export const loanListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(),
  ...pageQuery,
});

async function employeeIdsMatching(businessId: Types.ObjectId, query: string) {
  const rx = { $regex: escapeRegex(query), $options: "i" };
  const emps = await Employee.find({ businessId, $or: [{ name: rx }, { employeeCode: rx }] }, { _id: 1 }).lean<AnyDoc[]>();
  return emps.map((e) => e._id);
}

export async function listLoans(ctx: AuthContext, params: z.infer<typeof loanListSchema>, opts: { employeeId?: Types.ObjectId } = {}) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.status) filter.status = params.status;
  if (opts.employeeId) filter.employeeId = opts.employeeId;
  if (params.query) {
    filter.$or = [{ loanNumber: { $regex: escapeRegex(params.query), $options: "i" } }, { employeeId: { $in: await employeeIdsMatching(ctx.businessId, params.query) } }];
  }
  const [rows, total, outstanding] = await Promise.all([
    EmployeeLoan.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    EmployeeLoan.countDocuments(filter),
    EmployeeLoan.find({ businessId: ctx.businessId, status: "ACTIVE", ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) }, { amount: 1, repaidAmount: 1 }).lean<AnyDoc[]>(),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  return {
    items: rows.map((r) => loanRow(r, labels.get(String(r.employeeId)))),
    total,
    totalOutstanding: outstanding.reduce((t, l) => t.plus(d(l.amount).minus(d(l.repaidAmount))), new Decimal(0)).toFixed(2),
  };
}

export async function getLoan(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Loan not found");
  const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!loan) throw AppError.notFound("Loan not found");
  const labels = await employeeLabels(ctx.businessId, [loan.employeeId]);
  return loanRow(loan, labels.get(String(loan.employeeId)));
}

/** A repayment made outside payroll (cash, bank transfer). */
export async function recordRepayment(ctx: AuthContext, id: string, input: z.infer<typeof repaymentSchema>) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Loan not found");
  const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId });
  if (!loan) throw AppError.notFound("Loan not found");
  if (loan.status !== "ACTIVE") throw AppError.badRequest("This loan is not active", "LOAN_NOT_ACTIVE");
  const outstanding = d(loan.amount).minus(d(loan.repaidAmount));
  const amount = new Decimal(input.amount);
  if (amount.gt(outstanding)) throw AppError.badRequest(`Only ${outstanding.toFixed(2)} is outstanding`, "OVERPAYMENT");
  const now = new Date();
  loan.repayments.push({ payrollRunId: null, month: now.getUTCMonth() + 1, year: now.getUTCFullYear(), amount: toDecimal128(amount), note: input.note || "Paid directly" });
  const repaid = d(loan.repaidAmount).plus(amount);
  loan.repaidAmount = toDecimal128(repaid);
  if (repaid.gte(d(loan.amount))) loan.status = "CLOSED";
  loan.updatedBy = ctx.userId;
  await loan.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.loans", documentType: "EmployeeLoan", documentId: loan._id, newValue: { repayment: input.amount } });
  return { id, status: loan.status };
}

/** Only a loan nothing has been recovered on can be cancelled. */
export async function cancelLoan(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Loan not found");
  const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId });
  if (!loan) throw AppError.notFound("Loan not found");
  if (loan.status !== "ACTIVE") throw AppError.badRequest("This loan is not active", "LOAN_NOT_ACTIVE");
  if ((loan.repayments ?? []).length > 0) throw AppError.badRequest("Instalments have already been recovered on this loan", "LOAN_HAS_REPAYMENTS");
  loan.status = "CANCELLED";
  loan.updatedBy = ctx.userId;
  await loan.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "hr.loans", documentType: "EmployeeLoan", documentId: loan._id });
  return { id, status: "CANCELLED" };
}

/* ------------------------------------------------------------------ */
/* Expense claims                                                      */
/* ------------------------------------------------------------------ */

export const claimCreateSchema = z.object({
  employeeId: objectId.optional(),
  claimDate: z.string().trim().min(1, "Choose the date"),
  category: z.enum(CLAIM_CATEGORIES).default("OTHER"),
  amount: positive,
  description: z.string().trim().min(3, "Say what it was for").max(1000),
  billReference: z.string().trim().max(100).optional().default(""),
});

export const claimListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.string().trim().max(20).optional(),
  ...pageQuery,
});

function claimRow(c: AnyDoc, label?: { name: string; code: string; department: string }) {
  return {
    id: String(c._id),
    claimNumber: c.claimNumber,
    employeeId: String(c.employeeId),
    employeeName: label?.name ?? "—",
    employeeCode: label?.code ?? "",
    department: label?.department ?? "",
    claimDate: dayKey(toDay(c.claimDate)),
    category: c.category,
    amount: d(c.amount).toFixed(2),
    description: c.description,
    billReference: c.billReference,
    status: c.status,
    decisionNote: c.decisionNote,
    decidedAt: c.decidedAt,
    reimbursedInPayroll: Boolean(c.payrollRunId),
    createdAt: c.createdAt,
  };
}

export async function createClaim(ctx: AuthContext, input: z.infer<typeof claimCreateSchema>, opts: { self: boolean }) {
  const emp = opts.self ? await selfEmployee(ctx) : await findEmployee(ctx.businessId, input.employeeId ?? "");
  const claimNumber = await nextHrNumber(ctx.businessId, "HR_CLAIM", "CLM");
  const claim = await ExpenseClaim.create({
    businessId: ctx.businessId,
    claimNumber,
    employeeId: emp._id,
    claimDate: toDay(input.claimDate),
    category: input.category,
    amount: toDecimal128(new Decimal(input.amount)),
    description: input.description,
    billReference: input.billReference,
    status: "PENDING",
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.claims", documentType: "ExpenseClaim", documentId: claim._id, newValue: { claimNumber, amount: input.amount } });
  return { id: String(claim._id), claimNumber };
}

export async function listClaims(ctx: AuthContext, params: z.infer<typeof claimListSchema>, opts: { employeeId?: Types.ObjectId } = {}) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.status) filter.status = params.status;
  if (opts.employeeId) filter.employeeId = opts.employeeId;
  if (params.query) {
    filter.$or = [{ claimNumber: { $regex: escapeRegex(params.query), $options: "i" } }, { employeeId: { $in: await employeeIdsMatching(ctx.businessId, params.query) } }];
  }
  const [rows, total, pending] = await Promise.all([
    ExpenseClaim.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    ExpenseClaim.countDocuments(filter),
    ExpenseClaim.find({ businessId: ctx.businessId, status: "PENDING", ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) }, { amount: 1 }).lean<AnyDoc[]>(),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  return {
    items: rows.map((r) => claimRow(r, labels.get(String(r.employeeId)))),
    total,
    pendingCount: pending.length,
    pendingAmount: pending.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0)).toFixed(2),
  };
}

export async function decideClaim(ctx: AuthContext, id: string, decision: "APPROVED" | "REJECTED", note: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Claim not found");
  const claim = await ExpenseClaim.findOne({ _id: id, businessId: ctx.businessId });
  if (!claim) throw AppError.notFound("Claim not found");
  if (claim.status !== "PENDING") throw AppError.badRequest(`This claim is already ${claim.status.toLowerCase()}`, "CLAIM_NOT_PENDING");
  claim.set({ status: decision, decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: note, updatedBy: ctx.userId });
  await claim.save();
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: decision === "APPROVED" ? "APPROVE" : "REJECT", module: "hr.claims", documentType: "ExpenseClaim", documentId: claim._id, reason: note || undefined });
  return { id, status: decision };
}

/** The employee withdraws their own pending claim. */
export async function withdrawClaim(ctx: AuthContext, id: string) {
  const emp = await selfEmployee(ctx);
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Claim not found");
  const claim = await ExpenseClaim.findOne({ _id: id, businessId: ctx.businessId, employeeId: emp._id });
  if (!claim) throw AppError.notFound("Claim not found");
  if (claim.status !== "PENDING") throw AppError.badRequest("Only a pending claim can be withdrawn", "CLAIM_NOT_PENDING");
  claim.set({ status: "CANCELLED", updatedBy: ctx.userId });
  await claim.save();
  return { id, status: "CANCELLED" };
}

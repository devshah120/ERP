import mongoose, { Types } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { EmployeeLoan, ExpenseClaim, Employee, Payslip, PayrollRun, CLAIM_CATEGORIES, CLAIM_SETTLEMENT_MODES } from "@/models/hr";
import { moneyStringSchema } from "@/lib/validation/money";
import { toDecimal128 } from "@/lib/documents/decimal128";
import { recordAudit } from "@/lib/services/auditService";
import { MAX_FILE_BYTES, detectFileType, safeFileName } from "@/lib/storage/service";
import { approvalGate, openApproval, cancelApproval, approvalFingerprint, governingDocument, holdForApproval } from "@/lib/approvals/service";
import type { ApprovedRun } from "./attendance";

const TRAVEL_CATEGORIES = new Set(["TRAVEL", "ACCOMMODATION", "FUEL"]);
/** Travel and medical claims have schemes of their own; without one, the general Expense Claim scheme applies. */
function claimSpecificDocument(category: string): string {
  return TRAVEL_CATEGORIES.has(category) ? "hr-claim-travel" : category === "MEDICAL" ? "hr-claim-medical" : "hr-claim";
}
/** The approval document that governs this claim (the one its open request was raised under, if any). */
export function claimDocument(businessId: Types.ObjectId, claim: AnyDoc): Promise<string> {
  return governingDocument(businessId, claimSpecificDocument(String(claim.category ?? "OTHER")), claim._id);
}
export const CLAIM_DOCUMENTS = ["hr-claim", "hr-claim-travel", "hr-claim-medical"] as const;
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
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
    requestedBy: l.requestedBy ?? "HR",
    requestedAt: l.requestedAt ?? null,
    decisionNote: l.decisionNote ?? "",
    decidedAt: l.decidedAt ?? null,
    repayments: (l.repayments ?? []).map((r: AnyDoc) => ({ month: r.month, year: r.year, amount: d(r.amount).toFixed(2), note: r.note, at: r.at, viaClaims: (r.claimIds ?? []).length > 0 })),
    createdAt: l.createdAt,
  };
}

export async function createLoan(ctx: AuthContext, input: z.infer<typeof loanCreateSchema>, opts: ApprovedRun = {}) {
  const emp = await findEmployee(ctx.businessId, input.employeeId);
  if (!opts.approved) {
    const held = await holdForApproval(ctx, {
      document: "hr-advance-issue",
      targetKey: `loan-issue:${emp._id}:${approvalFingerprint(input)}`,
      recordId: emp._id,
      number: emp.employeeCode,
      summary: `Issue ${String(input.loanType).toLowerCase()} of ${new Decimal(input.amount).toFixed(2)} to ${emp.employeeCode} ${emp.name}`,
      details: [
        { label: "Employee", value: `${emp.employeeCode} ${emp.name}` },
        { label: "Type", value: String(input.loanType) },
        { label: "Amount", value: new Decimal(input.amount).toFixed(2) },
        { label: "Instalment", value: new Decimal(input.emiAmount).toFixed(2) },
        { label: "Recovery from", value: `${input.startMonth}/${input.startYear}` },
        { label: "Issued on", value: input.issueDate },
        { label: "Reason", value: input.reason ?? "" },
      ],
      amount: new Decimal(input.amount).toFixed(2),
      employeeId: emp._id,
      payload: input,
    });
    if (held) return held;
  }
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
  employeeId: z.string().trim().regex(/^([a-f\d]{24})?$/i).optional(),
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
  else if (params.employeeId) filter.employeeId = new Types.ObjectId(params.employeeId);
  if (params.query) {
    filter.$or = [{ loanNumber: { $regex: escapeRegex(params.query), $options: "i" } }, { employeeId: { $in: await employeeIdsMatching(ctx.businessId, params.query) } }];
  }
  const [rows, total, outstanding, requested] = await Promise.all([
    EmployeeLoan.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    EmployeeLoan.countDocuments(filter),
    EmployeeLoan.find({ businessId: ctx.businessId, status: "ACTIVE", ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) }, { amount: 1, repaidAmount: 1 }).lean<AnyDoc[]>(),
    EmployeeLoan.find({ businessId: ctx.businessId, status: "REQUESTED", ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) }, { amount: 1 }).lean<AnyDoc[]>(),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  return {
    items: rows.map((r) => loanRow(r, labels.get(String(r.employeeId)))),
    total,
    totalOutstanding: outstanding.reduce((t, l) => t.plus(d(l.amount).minus(d(l.repaidAmount))), new Decimal(0)).toFixed(2),
    requestedCount: requested.length,
    requestedAmount: requested.reduce((t, l) => t.plus(d(l.amount)), new Decimal(0)).toFixed(2),
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
export async function recordRepayment(ctx: AuthContext, id: string, input: z.infer<typeof repaymentSchema>, opts: ApprovedRun = {}) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Loan not found");
  const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId });
  if (!loan) throw AppError.notFound("Loan not found");
  if (loan.status !== "ACTIVE") throw AppError.badRequest("This loan is not active", "LOAN_NOT_ACTIVE");
  await assertNotInDraftPayroll(ctx.businessId, { loanId: loan._id });
  const outstanding = d(loan.amount).minus(d(loan.repaidAmount));
  const amount = new Decimal(input.amount);
  if (amount.gt(outstanding)) throw AppError.badRequest(`Only ${outstanding.toFixed(2)} is outstanding`, "OVERPAYMENT");
  if (!opts.approved) {
    const emp = await findEmployee(ctx.businessId, String(loan.employeeId));
    const held = await holdForApproval(ctx, {
      document: "hr-advance-settlement",
      targetKey: `loan:${loan._id}`,
      recordId: loan._id,
      number: loan.loanNumber,
      summary: `Repayment of ${amount.toFixed(2)} on ${loan.loanNumber} (${emp.employeeCode} ${emp.name})`,
      details: [
        { label: "Employee", value: `${emp.employeeCode} ${emp.name}` },
        { label: "Advance", value: loan.loanNumber },
        { label: "Outstanding", value: outstanding.toFixed(2) },
        { label: "Repayment", value: amount.toFixed(2) },
        { label: "Note", value: input.note ?? "" },
      ],
      amount: amount.toFixed(2),
      employeeId: loan.employeeId,
      payload: { op: "repayment", id, input },
    });
    if (held) return held;
  }
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
  employeeId: z.string().trim().regex(/^([a-f\d]{24})?$/i).optional(),
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
    attachment: c.attachment ? { fileName: c.attachment.fileName, mimeType: c.attachment.mimeType, size: c.attachment.size } : null,
    status: c.status,
    decisionNote: c.decisionNote,
    decidedAt: c.decidedAt,
    reimbursedInPayroll: Boolean(c.payrollRunId),
    settlementMode: c.settlementMode ?? (c.payrollRunId ? "PAYROLL" : null),
    settledAt: c.settledAt ?? null,
    settlementReference: c.settlementReference ?? "",
    payInYear: c.payInYear ?? null,
    payInMonth: c.payInMonth ?? null,
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
  await openApproval(ctx, await claimDocument(ctx.businessId, claim), claimApprovalRecord(claim));
  return { id: String(claim._id), claimNumber };
}

function claimApprovalRecord(c: AnyDoc) {
  return { id: c._id, number: c.claimNumber, summary: c.description, amount: d(c.amount).toFixed(2), employeeId: c.employeeId, requestedByUserId: c.createdBy, fingerprint: approvalFingerprint([String(c.employeeId), d(c.amount).toFixed(2), String(c.description ?? ""), String(c.claimDate ?? "")]) };
}

function advanceApprovalRecord(l: AnyDoc) {
  return { id: l._id, number: l.loanNumber, summary: l.reason ?? "", amount: d(l.amount).toFixed(2), employeeId: l.employeeId, requestedByUserId: l.createdBy, fingerprint: approvalFingerprint([String(l.employeeId), d(l.amount).toFixed(2), d(l.emiAmount).toFixed(2)]) };
}

/* ---- Claim attachment (bill / receipt) ---- */

async function claimFor(ctx: AuthContext, id: string, employeeId?: Types.ObjectId, withData = false) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Claim not found");
  const q = ExpenseClaim.findOne({ _id: id, businessId: ctx.businessId, ...(employeeId ? { employeeId } : {}) });
  const claim = await (withData ? q.select("+attachment.data") : q);
  if (!claim) throw AppError.notFound("Claim not found");
  return claim;
}

/**
 * Attaches (or replaces) the bill for a claim. Only JPG, PNG or PDF up to 10 MB,
 * checked by the file's own bytes. Employees may change it only while the claim is pending.
 */
export async function setClaimAttachment(ctx: AuthContext, id: string, form: FormData, opts: { employeeId?: Types.ObjectId } = {}) {
  const claim = await claimFor(ctx, id, opts.employeeId);
  if (opts.employeeId && claim.status !== "PENDING") throw AppError.badRequest("The bill can only be changed while the claim is pending", "CLAIM_NOT_PENDING");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw AppError.badRequest("Choose a file to attach", "NO_FILE");
  if (file.size > MAX_FILE_BYTES) throw AppError.badRequest("File is larger than 10 MB", "FILE_TOO_LARGE");
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type) throw AppError.badRequest("Only JPG, JPEG, PNG and PDF files can be attached", "UNSUPPORTED_FILE");
  const attachment = { fileName: safeFileName(file.name || `${claim.claimNumber}.${type.ext}`), mimeType: type.mime, size: bytes.length, data: bytes, uploadedAt: new Date() };
  await ExpenseClaim.updateOne({ _id: claim._id, businessId: ctx.businessId }, { $set: { attachment, updatedBy: ctx.userId } });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.claims", documentType: "ExpenseClaim", documentId: claim._id, newValue: { attachment: attachment.fileName, size: attachment.size } });
  return { fileName: attachment.fileName, mimeType: attachment.mimeType, size: attachment.size };
}

export async function removeClaimAttachment(ctx: AuthContext, id: string, opts: { employeeId?: Types.ObjectId } = {}) {
  const claim = await claimFor(ctx, id, opts.employeeId);
  if (opts.employeeId && claim.status !== "PENDING") throw AppError.badRequest("The bill can only be changed while the claim is pending", "CLAIM_NOT_PENDING");
  await ExpenseClaim.updateOne({ _id: claim._id, businessId: ctx.businessId }, { $set: { attachment: null, updatedBy: ctx.userId } });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.claims", documentType: "ExpenseClaim", documentId: claim._id, oldValue: { attachment: claim.attachment?.fileName } });
}

export async function getClaimAttachment(ctx: AuthContext, id: string, opts: { employeeId?: Types.ObjectId } = {}) {
  const claim = await claimFor(ctx, id, opts.employeeId, true);
  const a = claim.attachment;
  if (!a?.data) throw AppError.notFound("No bill is attached to this claim");
  return { data: Buffer.from(a.data), mimeType: a.mimeType, fileName: a.fileName };
}

export async function listClaims(ctx: AuthContext, params: z.infer<typeof claimListSchema>, opts: { employeeId?: Types.ObjectId } = {}) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.status) filter.status = params.status;
  if (opts.employeeId) filter.employeeId = opts.employeeId;
  else if (params.employeeId) filter.employeeId = new Types.ObjectId(params.employeeId);
  if (params.query) {
    filter.$or = [{ claimNumber: { $regex: escapeRegex(params.query), $options: "i" } }, { employeeId: { $in: await employeeIdsMatching(ctx.businessId, params.query) } }];
  }
  const [rows, total, pending, approved] = await Promise.all([
    ExpenseClaim.find(filter).sort({ createdAt: -1 }).skip((params.page - 1) * params.pageSize).limit(params.pageSize).lean<AnyDoc[]>(),
    ExpenseClaim.countDocuments(filter),
    ExpenseClaim.find({ businessId: ctx.businessId, status: "PENDING", ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) }, { amount: 1 }).lean<AnyDoc[]>(),
    ExpenseClaim.find({ businessId: ctx.businessId, status: "APPROVED", ...(opts.employeeId ? { employeeId: opts.employeeId } : {}) }, { amount: 1 }).lean<AnyDoc[]>(),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  return {
    items: rows.map((r) => claimRow(r, labels.get(String(r.employeeId)))),
    total,
    pendingCount: pending.length,
    pendingAmount: pending.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0)).toFixed(2),
    unsettledCount: approved.length,
    unsettledAmount: approved.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0)).toFixed(2),
  };
}

export async function decideClaim(ctx: AuthContext, id: string, decision: "APPROVED" | "REJECTED", note: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Claim not found");
  const claim = await ExpenseClaim.findOne({ _id: id, businessId: ctx.businessId });
  if (!claim) throw AppError.notFound("Claim not found");
  if (claim.status !== "PENDING") throw AppError.badRequest(`This claim is already ${claim.status.toLowerCase()}`, "CLAIM_NOT_PENDING");
  const gate = await approvalGate(ctx, await claimDocument(ctx.businessId, claim), claimApprovalRecord(claim), decision === "APPROVED" ? "approve" : "reject", note);
  if (!gate.proceed) return { id, status: "PENDING", approvalMessage: gate.message };
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
  for (const doc of CLAIM_DOCUMENTS) await cancelApproval(ctx.businessId, doc, claim._id);
  return { id, status: "CANCELLED" };
}

/* ------------------------------------------------------------------ */
/* Advance requests                                                    */
/* ------------------------------------------------------------------ */

/**
 * A claim or loan already counted in a draft payroll must be paid (or
 * recovered) there; settling it on the side as well would pay or recover it
 * twice. Delete or regenerate the draft first.
 */
async function assertNotInDraftPayroll(businessId: Types.ObjectId, ref: { claimIds?: Types.ObjectId[]; loanId?: Types.ObjectId }) {
  const filter: Record<string, unknown> = { businessId, status: "DRAFT" };
  if (ref.claimIds) filter.claimIds = { $in: ref.claimIds };
  if (ref.loanId) filter["loanDeductions.loanId"] = ref.loanId;
  if (await Payslip.exists(filter)) {
    throw AppError.conflict(
      ref.loanId
        ? "A draft payroll already deducts an instalment of this advance. Approve or delete that draft first."
        : "A draft payroll already reimburses one of these claims. Approve it there, or delete the draft first.",
      "IN_DRAFT_PAYROLL"
    );
  }
}

export const advanceRequestSchema = z
  .object({
    employeeId: objectId.optional(),
    loanType: z.enum(["ADVANCE", "LOAN"]).default("ADVANCE"),
    amount: positive,
    /** What the employee proposes to repay each month. */
    emiAmount: positive,
    reason: z.string().trim().max(500).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (new Decimal(v.emiAmount).gt(new Decimal(v.amount))) ctx.addIssue({ code: "custom", path: ["emiAmount"], message: "Instalment is more than the amount" });
  });

/** An employee's request for a salary advance or loan; nothing is issued until HR approves it. */
export async function requestAdvance(ctx: AuthContext, input: z.infer<typeof advanceRequestSchema>, opts: { self: boolean }) {
  const emp = opts.self ? await selfEmployee(ctx) : await findEmployee(ctx.businessId, input.employeeId ?? "");
  if (await EmployeeLoan.exists({ businessId: ctx.businessId, employeeId: emp._id, status: "REQUESTED" })) {
    throw AppError.conflict("There is already a request waiting for a decision. Withdraw it or wait for HR.", "REQUEST_PENDING");
  }
  const today = new Date();
  const next = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const loanNumber = await nextHrNumber(ctx.businessId, "HR_LOAN", "LN");
  const loan = await EmployeeLoan.create({
    businessId: ctx.businessId,
    loanNumber,
    employeeId: emp._id,
    loanType: input.loanType,
    issueDate: toDay(today),
    amount: toDecimal128(new Decimal(input.amount)),
    emiAmount: toDecimal128(new Decimal(input.emiAmount)),
    startMonth: next.getUTCMonth() + 1,
    startYear: next.getUTCFullYear(),
    reason: input.reason,
    status: "REQUESTED",
    requestedBy: opts.self ? "EMPLOYEE" : "HR",
    requestedAt: today,
    createdBy: ctx.userId,
    updatedBy: ctx.userId,
  });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.loans", documentType: "EmployeeLoan", documentId: loan._id, newValue: { loanNumber, amount: input.amount, status: "REQUESTED" } });
  await openApproval(ctx, "hr-advance", advanceApprovalRecord(loan));
  return { id: String(loan._id), loanNumber };
}

export const advanceDecisionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("approve"),
      /** HR may approve less than asked, or change the instalment and start. */
      amount: positive,
      emiAmount: positive,
      issueDate: z.string().trim().min(1, "Choose the issue date"),
      startMonth: z.coerce.number().int().min(1).max(12),
      startYear: z.coerce.number().int().min(2000).max(2100),
      note: z.string().trim().max(500).optional().default(""),
    })
    .superRefine((v, ctx) => {
      if (new Decimal(v.emiAmount).gt(new Decimal(v.amount))) ctx.addIssue({ code: "custom", path: ["emiAmount"], message: "Instalment is more than the amount" });
    }),
  z.object({ action: z.literal("reject"), note: z.string().trim().min(3, "Give a reason").max(500) }),
]);

export async function decideAdvance(ctx: AuthContext, id: string, input: z.infer<typeof advanceDecisionSchema>) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Request not found");
  const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId });
  if (!loan) throw AppError.notFound("Request not found");
  if (loan.status !== "REQUESTED") throw AppError.badRequest(`This request is already ${String(loan.status).toLowerCase()}`, "REQUEST_DECIDED");
  const gate = await approvalGate(ctx, "hr-advance", advanceApprovalRecord(loan), input.action, input.note);
  if (!gate.proceed) return { id, status: "REQUESTED", approvalMessage: gate.message };
  const base = { decidedByUserId: ctx.userId, decidedAt: new Date(), decisionNote: input.note, updatedBy: ctx.userId };
  if (input.action === "approve") {
    loan.set({
      ...base,
      status: "ACTIVE",
      amount: toDecimal128(new Decimal(input.amount)),
      emiAmount: toDecimal128(new Decimal(input.emiAmount)),
      issueDate: toDay(input.issueDate),
      startMonth: input.startMonth,
      startYear: input.startYear,
    });
  } else {
    loan.set({ ...base, status: "REJECTED" });
  }
  await loan.save();
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: input.action === "approve" ? "APPROVE" : "REJECT",
    module: "hr.loans",
    documentType: "EmployeeLoan",
    documentId: loan._id,
    newValue: input.action === "approve" ? { amount: input.amount, emiAmount: input.emiAmount, start: `${input.startMonth}/${input.startYear}` } : undefined,
    reason: input.note || undefined,
  });
  return { id, status: loan.status as string };
}

/** The employee withdraws their own request before HR decides. */
export async function withdrawAdvanceRequest(ctx: AuthContext, id: string) {
  const emp = await selfEmployee(ctx);
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Request not found");
  const loan = await EmployeeLoan.findOne({ _id: id, businessId: ctx.businessId, employeeId: emp._id });
  if (!loan) throw AppError.notFound("Request not found");
  if (loan.status !== "REQUESTED") throw AppError.badRequest("Only a request waiting for a decision can be withdrawn", "REQUEST_DECIDED");
  loan.set({ status: "CANCELLED", updatedBy: ctx.userId });
  await loan.save();
  await cancelApproval(ctx.businessId, "hr-advance", loan._id);
  return { id, status: "CANCELLED" };
}

/* ------------------------------------------------------------------ */
/* Claim settlement                                                    */
/* ------------------------------------------------------------------ */

export const claimSettlementSchema = z.discriminatedUnion("mode", [
  /** Paid with a chosen month's payroll: the claim waits, approved, until that payroll is generated and approved. */
  z.object({
    mode: z.literal("PAYROLL"),
    claimIds: z.array(objectId).min(1, "Choose the claims to settle").max(500),
    payInMonth: z.coerce.number().int().min(1).max(12),
    payInYear: z.coerce.number().int().min(2000).max(2100),
  }),
  z.object({
    mode: z.enum(CLAIM_SETTLEMENT_MODES.filter((m) => m !== "PAYROLL" && m !== "ADVANCE") as ["CASH", "BANK", "CHEQUE"]),
    claimIds: z.array(objectId).min(1, "Choose the claims to settle").max(500),
    paidOn: z.string().trim().min(1, "Choose the payment date"),
    reference: z.string().trim().max(100).optional().default(""),
  }),
]);

/** Pays approved claims directly (cash, bank transfer or cheque) instead of with the next payroll. */
export async function settleClaims(ctx: AuthContext, input: z.infer<typeof claimSettlementSchema>, opts: ApprovedRun = {}) {
  const ids = [...new Set(input.claimIds)].map((id) => new Types.ObjectId(id));
  const claims = await ExpenseClaim.find({ businessId: ctx.businessId, _id: { $in: ids } }, { status: 1, claimNumber: 1, amount: 1 }).lean<AnyDoc[]>();
  if (claims.length !== ids.length) throw AppError.notFound("One of the claims was not found");
  const notReady = claims.filter((c) => c.status !== "APPROVED");
  if (notReady.length > 0) throw AppError.badRequest(`Only approved, unpaid claims can be settled (${notReady.map((c) => c.claimNumber).join(", ")})`, "CLAIM_NOT_APPROVED");
  await assertNotInDraftPayroll(ctx.businessId, { claimIds: ids });
  const total = claims.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0));
  if (!opts.approved) {
    const how = input.mode === "PAYROLL" ? `with ${MONTH_LABELS[input.payInMonth - 1]} ${input.payInYear} payroll` : `by ${String(input.mode).toLowerCase()}`;
    const held = await holdForApproval(ctx, {
      document: "hr-claim-settlement",
      targetKey: `claim-settle:${approvalFingerprint(ids.map(String).sort())}`,
      summary: `Pay ${claims.length} claim(s), ${total.toFixed(2)}, ${how}`,
      details: [
        { label: "Claims", value: claims.map((c) => c.claimNumber).join(", ") },
        { label: "Total", value: total.toFixed(2) },
        { label: "Paid", value: how },
        ...(input.mode !== "PAYROLL" ? [{ label: "Paid on", value: input.paidOn }, { label: "Reference", value: input.reference ?? "" }] : []),
      ],
      amount: total.toFixed(2),
      payload: input,
    });
    if (held) return held;
  }

  if (input.mode === "PAYROLL") {
    const run = await PayrollRun.findOne({ businessId: ctx.businessId, year: input.payInYear, month: input.payInMonth, status: { $ne: "CANCELLED" } }, { status: 1, runNumber: 1 }).lean<AnyDoc>();
    const label = `${MONTH_LABELS[input.payInMonth - 1]} ${input.payInYear}`;
    if (run && run.status !== "DRAFT") throw AppError.badRequest(`${label} payroll is already ${String(run.status).toLowerCase()}. Choose a later month.`, "PAYROLL_LOCKED");
    const res = await ExpenseClaim.updateMany(
      { businessId: ctx.businessId, _id: { $in: ids }, status: "APPROVED", payrollRunId: null },
      { payInYear: input.payInYear, payInMonth: input.payInMonth, updatedBy: ctx.userId }
    );
    await recordAudit({
      businessId: ctx.businessId,
      userId: ctx.userId,
      action: "UPDATE",
      module: "hr.claims",
      documentType: "ExpenseClaim",
      newValue: { scheduled: claims.map((c) => c.claimNumber), payroll: label, amount: total.toFixed(2) },
    });
    return { settled: 0, scheduled: res.modifiedCount, amount: total.toFixed(2), payroll: label, draftPayroll: run ? (run.runNumber as string) : null };
  }

  // The status in the filter keeps a claim from being paid twice by two people at once.
  const res = await ExpenseClaim.updateMany(
    { businessId: ctx.businessId, _id: { $in: ids }, status: "APPROVED", payrollRunId: null },
    { status: "REIMBURSED", settlementMode: input.mode, settledAt: toDay(input.paidOn), settlementReference: input.reference, settledByUserId: ctx.userId, updatedBy: ctx.userId }
  );
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.claims",
    documentType: "ExpenseClaim",
    newValue: { settled: claims.map((c) => c.claimNumber), mode: input.mode, reference: input.reference, amount: total.toFixed(2) },
  });
  return { settled: res.modifiedCount, scheduled: 0, amount: total.toFixed(2), payroll: null, draftPayroll: null };
}

export const adjustClaimsSchema = z.object({ claimIds: z.array(objectId).min(1, "Choose the claims to set off").max(200) });

/**
 * Settles an advance with the employee's approved claims: the claims are
 * marked reimbursed (set off against the advance) and their total is recorded
 * as a repayment, all in one transaction. The claims may not exceed what is
 * still owed.
 */
export async function adjustClaimsAgainstAdvance(ctx: AuthContext, loanId: string, input: z.infer<typeof adjustClaimsSchema>, opts: ApprovedRun = {}) {
  if (!Types.ObjectId.isValid(loanId)) throw AppError.notFound("Advance not found");
  const ids = [...new Set(input.claimIds)].map((id) => new Types.ObjectId(id));
  await assertNotInDraftPayroll(ctx.businessId, { loanId: new Types.ObjectId(loanId) });
  await assertNotInDraftPayroll(ctx.businessId, { claimIds: ids });
  if (!opts.approved) {
    // The same checks the transaction makes, so only a valid set-off is sent for approval.
    const loan = await EmployeeLoan.findOne({ _id: loanId, businessId: ctx.businessId }).lean<AnyDoc>();
    if (!loan) throw AppError.notFound("Advance not found");
    if (loan.status !== "ACTIVE") throw AppError.badRequest("This advance is not active", "LOAN_NOT_ACTIVE");
    const claims = await ExpenseClaim.find({ businessId: ctx.businessId, _id: { $in: ids } }).lean<AnyDoc[]>();
    if (claims.length !== ids.length) throw AppError.notFound("One of the claims was not found");
    for (const c of claims) {
      if (String(c.employeeId) !== String(loan.employeeId)) throw AppError.badRequest(`${c.claimNumber} belongs to another employee`, "CLAIM_OTHER_EMPLOYEE");
      if (c.status !== "APPROVED" || c.payrollRunId) throw AppError.badRequest(`${c.claimNumber} is not an approved, unpaid claim`, "CLAIM_NOT_APPROVED");
    }
    const total = claims.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0));
    const outstanding = d(loan.amount).minus(d(loan.repaidAmount));
    if (total.gt(outstanding)) throw AppError.badRequest(`The claims come to ${total.toFixed(2)} but only ${outstanding.toFixed(2)} is outstanding. Choose fewer claims.`, "OVERPAYMENT");
    const emp = await findEmployee(ctx.businessId, String(loan.employeeId));
    const held = await holdForApproval(ctx, {
      document: "hr-advance-settlement",
      targetKey: `loan:${loan._id}`,
      recordId: loan._id,
      number: loan.loanNumber,
      summary: `Set off ${claims.length} claim(s), ${total.toFixed(2)}, against ${loan.loanNumber} (${emp.employeeCode} ${emp.name})`,
      details: [
        { label: "Employee", value: `${emp.employeeCode} ${emp.name}` },
        { label: "Advance", value: loan.loanNumber },
        { label: "Outstanding", value: outstanding.toFixed(2) },
        { label: "Claims", value: claims.map((c) => c.claimNumber).join(", ") },
        { label: "Set off", value: total.toFixed(2) },
      ],
      amount: total.toFixed(2),
      employeeId: loan.employeeId,
      payload: { op: "adjust", id: loanId, input },
    });
    if (held) return held;
  }

  const session = await mongoose.startSession();
  let result: { id: string; status: string; adjusted: string } | null = null;
  try {
    await session.withTransaction(async () => {
      const loan = await EmployeeLoan.findOne({ _id: loanId, businessId: ctx.businessId }).session(session);
      if (!loan) throw AppError.notFound("Advance not found");
      if (loan.status !== "ACTIVE") throw AppError.badRequest("This advance is not active", "LOAN_NOT_ACTIVE");
      const claims = await ExpenseClaim.find({ businessId: ctx.businessId, _id: { $in: ids } }).session(session);
      if (claims.length !== ids.length) throw AppError.notFound("One of the claims was not found");
      for (const c of claims) {
        if (String(c.employeeId) !== String(loan.employeeId)) throw AppError.badRequest(`${c.claimNumber} belongs to another employee`, "CLAIM_OTHER_EMPLOYEE");
        if (c.status !== "APPROVED" || c.payrollRunId) throw AppError.badRequest(`${c.claimNumber} is not an approved, unpaid claim`, "CLAIM_NOT_APPROVED");
      }
      const total = claims.reduce((t, c) => t.plus(d(c.amount)), new Decimal(0));
      const outstanding = d(loan.amount).minus(d(loan.repaidAmount));
      if (total.gt(outstanding)) {
        throw AppError.badRequest(`The claims come to ${total.toFixed(2)} but only ${outstanding.toFixed(2)} is outstanding. Choose fewer claims.`, "OVERPAYMENT");
      }
      const now = new Date();
      loan.repayments.push({
        payrollRunId: null,
        month: now.getUTCMonth() + 1,
        year: now.getUTCFullYear(),
        amount: toDecimal128(total),
        note: `Set off against claims ${claims.map((c) => c.claimNumber).join(", ")}`,
        claimIds: ids,
      });
      const repaid = d(loan.repaidAmount).plus(total);
      loan.repaidAmount = toDecimal128(repaid);
      if (repaid.gte(d(loan.amount))) loan.status = "CLOSED";
      loan.updatedBy = ctx.userId;
      await loan.save({ session });
      await ExpenseClaim.updateMany(
        { businessId: ctx.businessId, _id: { $in: ids }, status: "APPROVED" },
        { status: "REIMBURSED", settlementMode: "ADVANCE", settledAt: toDay(now), settlementReference: loan.loanNumber, settledByUserId: ctx.userId, advanceLoanId: loan._id, updatedBy: ctx.userId },
        { session }
      );
      result = { id: loanId, status: loan.status as string, adjusted: total.toFixed(2) };
    });
  } finally {
    await session.endSession();
  }
  const done = result as unknown as { id: string; status: string; adjusted: string };
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.loans", documentType: "EmployeeLoan", documentId: new Types.ObjectId(loanId), newValue: { setOffAgainstClaims: done.adjusted } });
  return done;
}

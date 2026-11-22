import mongoose, { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import { PayrollRun, Payslip } from "@/models/hr";
import { Voucher } from "@/models/Voucher";
import { Account } from "@/models/Account";
import { postVoucher, reverseVoucherFor, type PostingEntry } from "@/lib/accounting/posting";
import { ensureChartOfAccounts } from "@/lib/accounting/chartOfAccounts";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { dayKey, toDay } from "./calendar";
import type { AnyDoc } from "./common";

/*
 * Voucher posting: payroll into the ERP general ledger, for workspaces that
 * have both products and a chart of accounts.
 *
 *   Approve (accrual, dated the last day of the month)
 *     Dr Salaries & Wages            gross earnings
 *     Dr Staff Expense Reimbursements reimbursed claims
 *     Dr Employer PF & ESI           employer contributions
 *       Cr PF Payable / ESI Payable  employee + employer shares
 *       Cr PT Payable, TDS Payable   as deducted
 *       Cr Loans & Advances to Employees   loan recovery
 *       Cr Recoveries from Employees       other deductions (canteen…)
 *       Cr Salaries Payable          net pay
 *   Mark paid
 *     Dr Salaries Payable  /  Cr Bank (bank and cheque) and Cash (cash)
 *   Roll back an approved run: the accrual is reversed by a mirror entry.
 */

export const PAYROLL_SOURCE = "PAYROLL_RUN";
export const PAYROLL_PAYMENT_SOURCE = "PAYROLL_PAYMENT";

const d = (v: unknown) => new Decimal(v ? String(v) : "0");
const sumBy = (lines: AnyDoc[] | undefined, pick: (code: string) => boolean) =>
  (lines ?? []).filter((l) => pick(l.code)).reduce((t, l) => t.plus(d(l.amount)), new Decimal(0));

/** Posting applies only when the workspace has ERP and its chart of accounts is set up. */
export async function payrollAccountingOn(ctx: AuthContext, session?: ClientSession): Promise<boolean> {
  if (!ctx.products.includes("ERP")) return false;
  const q = Account.countDocuments({ businessId: ctx.businessId });
  return (await (session ? q.session(session) : q)) > 0;
}

const STATUTORY = new Set(["PF", "ESI", "PT", "TDS", "LOAN"]);

/** The accrual journal for a run's payslips. Pure, so it can be tested and previewed. */
export function accrualEntries(slips: AnyDoc[]): PostingEntry[] {
  let gross = new Decimal(0);
  let reimb = new Decimal(0);
  let employerPf = new Decimal(0);
  let employerEsi = new Decimal(0);
  let pf = new Decimal(0);
  let esi = new Decimal(0);
  let pt = new Decimal(0);
  let tds = new Decimal(0);
  let loans = new Decimal(0);
  let other = new Decimal(0);
  let net = new Decimal(0);
  for (const s of slips) {
    gross = gross.plus(d(s.grossEarnings));
    reimb = reimb.plus(d(s.reimbursements));
    employerPf = employerPf.plus(sumBy(s.employerContributions, (c) => c === "PF_ER"));
    employerEsi = employerEsi.plus(sumBy(s.employerContributions, (c) => c === "ESI_ER"));
    pf = pf.plus(sumBy(s.deductions, (c) => c === "PF"));
    esi = esi.plus(sumBy(s.deductions, (c) => c === "ESI"));
    pt = pt.plus(sumBy(s.deductions, (c) => c === "PT"));
    tds = tds.plus(sumBy(s.deductions, (c) => c === "TDS"));
    loans = loans.plus(sumBy(s.deductions, (c) => c === "LOAN"));
    other = other.plus(sumBy(s.deductions, (c) => !STATUTORY.has(c)));
    net = net.plus(d(s.netPay));
  }
  return [
    { role: "SALARY_EXPENSE", debit: gross, narration: "Gross salaries" },
    { role: "STAFF_REIMBURSEMENT_EXPENSE", debit: reimb, narration: "Expense claims reimbursed" },
    { role: "EMPLOYER_CONTRIBUTION_EXPENSE", debit: employerPf.plus(employerEsi), narration: "Employer PF and ESI" },
    { role: "PF_PAYABLE", credit: pf.plus(employerPf), narration: "PF: employee + employer" },
    { role: "ESI_PAYABLE", credit: esi.plus(employerEsi), narration: "ESI: employee + employer" },
    { role: "PT_PAYABLE", credit: pt, narration: "Professional tax deducted" },
    { role: "TDS_PAYABLE", credit: tds, narration: "TDS on salaries" },
    { role: "EMPLOYEE_ADVANCES", credit: loans, narration: "Loan and advance recovery" },
    { role: "SALARY_RECOVERIES", credit: other, narration: "Other recoveries" },
    // A negative net (deductions above pay) would be a debit; payroll never produces one, but keep the books balanced if it did.
    net.gte(0) ? { role: "SALARY_PAYABLE", credit: net, narration: "Net pay due" } : { role: "SALARY_PAYABLE", debit: net.negated(), narration: "Net pay due" },
  ];
}

/** The payment journal: net pay out of the bank (bank and cheque) or cash. */
export function paymentEntries(slips: AnyDoc[]): PostingEntry[] {
  let bank = new Decimal(0);
  let cash = new Decimal(0);
  for (const s of slips) {
    const net = d(s.netPay);
    if (net.lte(0)) continue;
    if (s.employee?.paymentMode === "CASH") cash = cash.plus(net);
    else bank = bank.plus(net);
  }
  return [
    { role: "SALARY_PAYABLE", debit: bank.plus(cash), narration: "Salaries paid" },
    { role: "BANK", credit: bank, narration: "Salaries by bank transfer / cheque" },
    { role: "CASH", credit: cash, narration: "Salaries in cash" },
  ];
}

const monthEnd = (run: AnyDoc) => new Date(Date.UTC(run.year, run.month, 0));

/**
 * True when a voucher already exists for this run and source (posted or reversed).
 * Checked before writing: postVoucher's duplicate-key fallback can't be relied on
 * inside a transaction, because the failed insert aborts the transaction.
 */
async function alreadyPosted(businessId: Types.ObjectId, sourceType: string, runId: Types.ObjectId, session: ClientSession): Promise<boolean> {
  return Boolean(await Voucher.exists({ businessId, sourceType, sourceId: runId }).session(session));
}

/** Errors that mean "the books aren't ready", which must not stop payroll itself. */
const NOT_READY = new Set(["COA_INCOMPLETE", "NO_FINANCIAL_YEAR", "NO_BRANCH"]);

async function guarded(fn: () => Promise<AnyDoc | null>): Promise<{ voucher: AnyDoc | null; skipped?: string }> {
  try {
    return { voucher: await fn() };
  } catch (err) {
    if (err instanceof AppError && NOT_READY.has(err.code)) return { voucher: null, skipped: err.message };
    throw err;
  }
}

/** Posts the approval journal inside the caller's transaction. Idempotent; skipped quietly when accounting isn't set up. */
export async function postPayrollAccrual(ctx: AuthContext, run: AnyDoc, slips: AnyDoc[], session: ClientSession) {
  if (!(await payrollAccountingOn(ctx, session))) return { voucher: null, skipped: "Accounting is not set up in this workspace" };
  if (await alreadyPosted(ctx.businessId, PAYROLL_SOURCE, run._id, session)) return { voucher: null };
  await ensureChartOfAccounts(ctx.businessId, ctx.userId, session);
  return guarded(() =>
    postVoucher({
      businessId: ctx.businessId,
      userId: ctx.userId,
      voucherType: "JOURNAL",
      voucherDate: monthEnd(run),
      entries: accrualEntries(slips),
      narration: `Payroll ${run.runNumber} for ${run.month}/${run.year}`,
      referenceNumber: run.runNumber,
      source: { type: PAYROLL_SOURCE, id: run._id, number: run.runNumber },
      session,
    })
  );
}

/** Posts the payment journal inside the caller's transaction (after the accrual exists). */
export async function postPayrollPayment(ctx: AuthContext, run: AnyDoc, slips: AnyDoc[], session: ClientSession) {
  if (!(await payrollAccountingOn(ctx, session))) return { voucher: null, skipped: "Accounting is not set up in this workspace" };
  const accrued = await Voucher.exists({ businessId: ctx.businessId, sourceType: PAYROLL_SOURCE, sourceId: run._id, status: "POSTED" }).session(session);
  if (!accrued) return { voucher: null, skipped: "The approval voucher is not posted yet" };
  if (await alreadyPosted(ctx.businessId, PAYROLL_PAYMENT_SOURCE, run._id, session)) return { voucher: null };
  return guarded(() =>
    postVoucher({
      businessId: ctx.businessId,
      userId: ctx.userId,
      voucherType: "PAYMENT",
      voucherDate: run.paidAt ? toDay(run.paidAt) : new Date(),
      entries: paymentEntries(slips),
      narration: `Salaries paid for ${run.month}/${run.year}${run.paymentReference ? `, ref ${run.paymentReference}` : ""}`,
      referenceNumber: run.paymentReference || run.runNumber,
      source: { type: PAYROLL_PAYMENT_SOURCE, id: run._id, number: run.runNumber },
      session,
    })
  );
}

/** Reverses the approval journal when an approved run is rolled back. */
export async function reversePayrollAccrual(ctx: AuthContext, run: AnyDoc, reason: string, session: ClientSession) {
  return reverseVoucherFor({ businessId: ctx.businessId, userId: ctx.userId, sourceType: PAYROLL_SOURCE, sourceId: run._id, reason, session });
}

/* ------------------------------------------------------------------ */
/* Voucher Posting screen                                              */
/* ------------------------------------------------------------------ */

/** Approved and paid runs with their vouchers, so anything missing can be posted. */
export async function payrollVouchers(ctx: AuthContext) {
  const enabled = await payrollAccountingOn(ctx);
  const runs = await PayrollRun.find({ businessId: ctx.businessId, status: { $in: ["APPROVED", "PAID", "CANCELLED"] } })
    .sort({ year: -1, month: -1, createdAt: -1 })
    .limit(36)
    .lean<AnyDoc[]>();
  const vouchers = await Voucher.find(
    { businessId: ctx.businessId, sourceId: { $in: runs.map((r) => r._id) }, sourceType: { $in: [PAYROLL_SOURCE, PAYROLL_PAYMENT_SOURCE, `${PAYROLL_SOURCE}_REVERSAL`] } },
    { voucherNumber: 1, sourceType: 1, sourceId: 1, status: 1, voucherDate: 1, totalDebit: 1 }
  ).lean<AnyDoc[]>();
  const find = (runId: unknown, type: string) => {
    const v = vouchers.find((x) => String(x.sourceId) === String(runId) && x.sourceType === type);
    return v ? { id: String(v._id), number: v.voucherNumber as string, status: v.status as string, date: dayKey(toDay(v.voucherDate)), amount: d(v.totalDebit).toFixed(2) } : null;
  };
  return {
    enabled,
    reason: enabled ? null : ctx.products.includes("ERP") ? "Set up the chart of accounts in ERP to post payroll vouchers." : "Voucher posting needs NEXORA ERP in this workspace.",
    items: runs
      // Cancelled runs only matter when they had been posted (their reversal is shown).
      .filter((r) => r.status !== "CANCELLED" || find(r._id, PAYROLL_SOURCE))
      .map((r) => {
        const accrual = find(r._id, PAYROLL_SOURCE);
        const payment = find(r._id, PAYROLL_PAYMENT_SOURCE);
        const reversal = find(r._id, `${PAYROLL_SOURCE}_REVERSAL`);
        const missing = r.status !== "CANCELLED" && (!accrual || (r.status === "PAID" && !payment));
        return { id: String(r._id), runNumber: r.runNumber, month: r.month, year: r.year, status: r.status, totalNet: d(r.totalNet).toFixed(2), accrual, payment, reversal, missing };
      }),
  };
}

/** Posts whatever is missing for a run (approval journal, and payment journal if paid). */
export async function postMissingPayrollVouchers(ctx: AuthContext, runId: string) {
  if (!Types.ObjectId.isValid(runId)) throw AppError.notFound("Payroll run not found");
  if (!(await payrollAccountingOn(ctx))) {
    throw AppError.badRequest(ctx.products.includes("ERP") ? "Set up the chart of accounts in ERP first." : "Voucher posting needs NEXORA ERP in this workspace.", "ACCOUNTING_OFF");
  }
  const run = await PayrollRun.findOne({ _id: runId, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!run) throw AppError.notFound("Payroll run not found");
  if (!["APPROVED", "PAID"].includes(run.status)) throw AppError.badRequest("Only approved or paid payroll is posted to the books.", "PAYROLL_NOT_APPROVED");
  const slips = await Payslip.find({ businessId: ctx.businessId, payrollRunId: run._id }).lean<AnyDoc[]>();

  const session = await mongoose.startSession();
  const posted: string[] = [];
  try {
    await session.withTransaction(async () => {
      posted.length = 0;
      const a = await postPayrollAccrual(ctx, run, slips, session);
      if (a.skipped) throw AppError.badRequest(a.skipped, "VOUCHER_NOT_POSTED");
      if (a.voucher) posted.push(a.voucher.voucherNumber);
      if (run.status === "PAID") {
        const p = await postPayrollPayment(ctx, run, slips, session);
        if (p.skipped) throw AppError.badRequest(p.skipped, "VOUCHER_NOT_POSTED");
        if (p.voucher) posted.push(p.voucher.voucherNumber);
      }
    });
  } finally {
    await session.endSession();
  }
  if (posted.length > 0) {
    await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.payroll", documentType: "PayrollRun", documentId: run._id, newValue: { vouchersPosted: posted } });
  }
  return { id: runId, posted };
}

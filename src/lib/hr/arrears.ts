import { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Payslip, PayrollArrear, Employee, PayrollRun } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import type { AuthContext } from "@/lib/auth/context";
import { monthRange } from "./calendar";
import { salaryForMonth } from "./history";
import { findEmployee, employeeLabels, monthQuery, objectId, type AnyDoc } from "./common";
import { holdForApproval } from "@/lib/approvals/service";
import type { ApprovedRun } from "./attendance";

/*
 * Arrears: pay owed for months whose payroll is already approved, paid with
 * the next payroll as earning lines.
 *   INCREMENT — a salary revision backdated into approved months: new rate
 *               minus what was paid, for the same paid days.
 *   DAY       — loss-of-pay days of an approved month paid back.
 *   DA        — a percentage of the basic actually paid over a range of
 *               approved months (dearness allowance revisions).
 * PENDING arrears are picked up by the next payroll; approval marks them
 * INCLUDED and rolling that payroll back returns them to PENDING.
 */

export const ARREAR_LABELS: Record<string, { code: string; label: string }> = {
  INCREMENT: { code: "ARR_INC", label: "Increment arrears" },
  DAY: { code: "ARR_DAY", label: "Day arrears" },
  DA: { code: "ARR_DA", label: "DA arrears" },
};

const FIXED: [string, string][] = [
  ["BASIC", "basic"],
  ["HRA", "hra"],
  ["CONV", "conveyance"],
  ["SPECIAL", "specialAllowance"],
  ["OTHER", "otherAllowance"],
];
const LABEL: Record<string, string> = { BASIC: "Basic", HRA: "HRA", CONV: "Conveyance", SPECIAL: "Special allowance", OTHER: "Other allowance" };

const d = (v: unknown) => new Decimal(v ? String(v) : "0");
const money = (v: Decimal) => v.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const ym = (y: number, m: number) => y * 12 + (m - 1);
const lineOf = (lines: AnyDoc[] | undefined, code: string) => d((lines ?? []).find((l) => l.code === code)?.amount);

/** The employee's approved or paid payslips from a month onwards, oldest first. */
async function lockedSlips(businessId: Types.ObjectId, employeeId: Types.ObjectId, fromYear: number, fromMonth: number, session?: ClientSession) {
  const q = Payslip.find({ businessId, employeeId, status: { $in: ["APPROVED", "PAID"] } });
  const rows = await (session ? q.session(session) : q).lean<AnyDoc[]>();
  return rows.filter((s) => ym(s.year, s.month) >= ym(fromYear, fromMonth)).sort((a, b) => ym(a.year, a.month) - ym(b.year, b.month));
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */

/** Pending arrears of these employees, as earning lines (one per kind) for the next payslip. */
export async function pendingArrearLines(businessId: Types.ObjectId, employeeIds: Types.ObjectId[], session?: ClientSession) {
  const q = PayrollArrear.find({ businessId, employeeId: { $in: employeeIds }, status: "PENDING" });
  const rows = await (session ? q.session(session) : q).lean<AnyDoc[]>();
  const out = new Map<string, { lines: { code: string; label: string; kind: "EARNING"; amount: string; esiApplicable: boolean }[]; ids: Types.ObjectId[] }>();
  for (const r of rows) {
    const k = String(r.employeeId);
    if (!out.has(k)) out.set(k, { lines: [], ids: [] });
    const entry = out.get(k)!;
    entry.ids.push(r._id);
    const meta = ARREAR_LABELS[r.kind];
    const line = entry.lines.find((l) => l.code === meta.code);
    if (line) line.amount = d(line.amount).plus(d(r.amount)).toFixed(2);
    else entry.lines.push({ code: meta.code, label: meta.label, kind: "EARNING", amount: d(r.amount).toFixed(2), esiApplicable: true });
  }
  return out;
}

/** Marks a run's arrears paid (on approval) or pending again (on rollback). */
export async function settleArrears(businessId: Types.ObjectId, ids: Types.ObjectId[], runId: Types.ObjectId | null, session: ClientSession) {
  if (runId) await PayrollArrear.updateMany({ businessId, _id: { $in: ids }, status: "PENDING" }, { status: "INCLUDED", payrollRunId: runId }, { session });
}

export async function reopenArrears(businessId: Types.ObjectId, runId: Types.ObjectId, session: ClientSession) {
  await PayrollArrear.updateMany({ businessId, payrollRunId: runId, status: "INCLUDED" }, { status: "PENDING", payrollRunId: null }, { session });
}

/* ------------------------------------------------------------------ */
/* Increment arrears (from employment history)                          */
/* ------------------------------------------------------------------ */

/**
 * After a salary revision dated into approved months: for each such month,
 * the fixed earnings at the new rate for the days that were paid, minus what
 * was paid. Runs in the history transaction. Returns how many were created.
 */
export async function createIncrementArrears(ctx: AuthContext, emp: AnyDoc, effective: Date, changeId: Types.ObjectId, session: ClientSession): Promise<number> {
  const slips = await lockedSlips(ctx.businessId, emp._id, effective.getUTCFullYear(), effective.getUTCMonth() + 1, session);
  let created = 0;
  for (const slip of slips) {
    const { start, end } = monthRange(slip.year, slip.month);
    const salary = (await salaryForMonth(ctx.businessId, [emp], start, end, session)).get(String(emp._id))!;
    const ratio = new Decimal(slip.payableDays).dividedBy(slip.daysInMonth);
    const breakdown = FIXED.map(([code, field]) => {
      const due = money((salary as unknown as Record<string, Decimal>)[field].times(ratio));
      return { code, label: LABEL[code], amount: due.minus(lineOf(slip.earnings, code)) };
    }).filter((b) => !b.amount.isZero());
    const total = breakdown.reduce((t, b) => t.plus(b.amount), new Decimal(0));
    if (total.lte(0)) continue;
    await PayrollArrear.create(
      [
        {
          businessId: ctx.businessId,
          employeeId: emp._id,
          kind: "INCREMENT",
          fromYear: slip.year,
          fromMonth: slip.month,
          toYear: slip.year,
          toMonth: slip.month,
          amount: toDecimal128(money(total)),
          breakdown: breakdown.map((b) => ({ code: b.code, label: b.label, amount: toDecimal128(money(b.amount)) })),
          reason: `Salary revision from ${effective.toISOString().slice(0, 10)}`,
          sourceChangeId: changeId,
          createdBy: ctx.userId,
        },
      ],
      { session }
    );
    created += 1;
  }
  return created;
}

/** A backdated revision can be undone only while none of its arrears has been paid. */
export async function cancelArrearsOfChange(businessId: Types.ObjectId, changeId: Types.ObjectId, session: ClientSession): Promise<void> {
  const paid = await PayrollArrear.exists({ businessId, sourceChangeId: changeId, status: "INCLUDED" }).session(session);
  if (paid) throw AppError.badRequest("Arrears from this revision have already been paid, so it can't be removed.", "ARREARS_PAID");
  await PayrollArrear.updateMany({ businessId, sourceChangeId: changeId, status: "PENDING" }, { status: "CANCELLED" }, { session });
}

/* ------------------------------------------------------------------ */
/* Day arrears                                                         */
/* ------------------------------------------------------------------ */

export const dayArrearSchema = monthQuery.extend({
  employeeId: objectId,
  days: z.coerce.number().positive("Enter the days to pay back").multipleOf(0.5, "Use whole or half days"),
  reason: z.string().trim().min(3, "Give a reason").max(300),
});

/** Pays back loss-of-pay days of an approved month at that month's daily rate. */
export async function createDayArrear(ctx: AuthContext, input: z.infer<typeof dayArrearSchema>, opts: ApprovedRun = {}) {
  const emp = await findEmployee(ctx.businessId, input.employeeId);
  const slip = await Payslip.findOne({ businessId: ctx.businessId, employeeId: emp._id, year: input.year, month: input.month, status: { $in: ["APPROVED", "PAID"] } }).lean<AnyDoc>();
  if (!slip) throw AppError.badRequest(`${emp.name} has no approved payslip for ${input.month}/${input.year}. Correct attendance and recalculate that payroll instead.`, "NO_LOCKED_PAYSLIP");
  const already = await PayrollArrear.find({ businessId: ctx.businessId, employeeId: emp._id, kind: "DAY", fromYear: input.year, fromMonth: input.month, status: { $ne: "CANCELLED" } }).lean<AnyDoc[]>();
  const granted = already.reduce((t, a) => t + (a.days ?? 0), 0);
  if (input.days + granted > (slip.lopDays ?? 0)) {
    throw AppError.badRequest(`Only ${(slip.lopDays ?? 0) - granted} loss-of-pay day(s) of that month are left to pay back.`, "TOO_MANY_DAYS");
  }
  // The full-month structure the payslip used (older payslips: back out the prorated lines).
  const ratio = new Decimal(slip.payableDays).dividedBy(slip.daysInMonth);
  const fullOf = (code: string, field: string) => (slip.structure?.[field] !== undefined ? d(slip.structure[field]) : ratio.isZero() ? new Decimal(0) : lineOf(slip.earnings, code).dividedBy(ratio));
  const breakdown = FIXED.map(([code, field]) => ({ code, label: LABEL[code], amount: money(fullOf(code, field).times(input.days).dividedBy(slip.daysInMonth)) })).filter((b) => b.amount.gt(0));
  const total = breakdown.reduce((t, b) => t.plus(b.amount), new Decimal(0));
  if (total.lte(0)) throw AppError.badRequest("That month's salary was zero, so there is nothing to pay back.", "NOTHING_TO_PAY");
  if (!opts.approved) {
    const held = await holdForApproval(ctx, {
      document: "hr-arrear",
      targetKey: `arrear-day:${emp._id}:${input.year}-${input.month}`,
      recordId: emp._id,
      number: emp.employeeCode,
      summary: `Day arrear for ${emp.employeeCode} ${emp.name}: ${input.days} day(s) of ${input.month}/${input.year}, ${total.toFixed(2)}`,
      details: [
        { label: "Employee", value: `${emp.employeeCode} ${emp.name}` },
        { label: "Kind", value: "Day arrear (loss of pay paid back)" },
        { label: "Month", value: `${input.month}/${input.year}` },
        { label: "Days", value: String(input.days) },
        ...breakdown.map((b) => ({ label: b.label, value: b.amount.toFixed(2) })),
        { label: "Total", value: total.toFixed(2) },
        { label: "Reason", value: input.reason },
      ],
      amount: total.toFixed(2),
      employeeId: emp._id,
      payload: { kind: "DAY", input },
    });
    if (held) return held;
  }
  const doc = await PayrollArrear.create({
    businessId: ctx.businessId,
    employeeId: emp._id,
    kind: "DAY",
    fromYear: input.year,
    fromMonth: input.month,
    toYear: input.year,
    toMonth: input.month,
    days: input.days,
    amount: toDecimal128(total),
    breakdown: breakdown.map((b) => ({ code: b.code, label: b.label, amount: toDecimal128(b.amount) })),
    reason: input.reason,
    createdBy: ctx.userId,
  });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.payroll", documentType: "PayrollArrear", documentId: doc._id, newValue: { kind: "DAY", employee: emp.employeeCode, month: input.month, year: input.year, days: input.days, amount: total.toFixed(2) }, reason: input.reason });
  return { id: String(doc._id), amount: total.toFixed(2) };
}

/* ------------------------------------------------------------------ */
/* DA arrears                                                          */
/* ------------------------------------------------------------------ */

export const daArrearSchema = z
  .object({
    percent: z.coerce.number().positive("Enter the DA increase as a percentage of basic").max(100),
    fromYear: z.coerce.number().int().min(2000).max(2100),
    fromMonth: z.coerce.number().int().min(1).max(12),
    toYear: z.coerce.number().int().min(2000).max(2100),
    toMonth: z.coerce.number().int().min(1).max(12),
    departmentId: z.string().trim().optional(),
    reason: z.string().trim().min(3, "Give a reason, e.g. the DA notification").max(300),
    commit: z.boolean().optional().default(false),
  })
  .refine((v) => ym(v.toYear, v.toMonth) >= ym(v.fromYear, v.fromMonth), { message: "The end month is before the start month", path: ["toMonth"] });

/**
 * A DA revision applied retrospectively: percent × the basic actually paid in
 * each approved month of the range, one arrear per employee. Preview first,
 * then commit; an employee who already has DA arrears for an overlapping
 * range is skipped.
 */
export async function createDaArrears(ctx: AuthContext, input: z.infer<typeof daArrearSchema>, opts: ApprovedRun = {}) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId, status: { $in: ["APPROVED", "PAID"] } };
  const slips = (await Payslip.find(filter).lean<AnyDoc[]>()).filter((s) => ym(s.year, s.month) >= ym(input.fromYear, input.fromMonth) && ym(s.year, s.month) <= ym(input.toYear, input.toMonth));
  let empIds = [...new Set(slips.map((s) => String(s.employeeId)))];
  if (input.departmentId && Types.ObjectId.isValid(input.departmentId)) {
    const inDept = await Employee.find({ businessId: ctx.businessId, _id: { $in: empIds }, departmentId: input.departmentId }, { _id: 1 }).lean<AnyDoc[]>();
    const keep = new Set(inDept.map((e) => String(e._id)));
    empIds = empIds.filter((id) => keep.has(id));
  }
  const existing = await PayrollArrear.find({ businessId: ctx.businessId, kind: "DA", status: { $ne: "CANCELLED" }, employeeId: { $in: empIds } }).lean<AnyDoc[]>();
  const overlapping = new Set(
    existing.filter((a) => ym(a.fromYear, a.fromMonth) <= ym(input.toYear, input.toMonth) && ym(a.toYear, a.toMonth) >= ym(input.fromYear, input.fromMonth)).map((a) => String(a.employeeId))
  );
  const labels = await employeeLabels(ctx.businessId, empIds);
  const rate = new Decimal(input.percent).dividedBy(100);

  const rows = empIds.map((id) => {
    const mine = slips.filter((s) => String(s.employeeId) === id);
    const basic = mine.reduce((t, s) => t.plus(lineOf(s.earnings, "BASIC")), new Decimal(0));
    return { employeeId: id, name: labels.get(id)?.name ?? "—", code: labels.get(id)?.code ?? "", months: mine.length, basic: basic.toFixed(2), amount: money(basic.times(rate)).toFixed(2), skipped: overlapping.has(id) };
  }).filter((r) => new Decimal(r.amount).gt(0)).sort((a, b) => a.code.localeCompare(b.code));

  const toCreate = rows.filter((r) => !r.skipped);
  if (input.commit && toCreate.length > 0 && !opts.approved) {
    const total = toCreate.reduce((t, r) => t.plus(r.amount), new Decimal(0)).toFixed(2);
    const held = await holdForApproval(ctx, {
      document: "hr-arrear",
      targetKey: `arrear-da:${input.fromYear}-${input.fromMonth}:${input.toYear}-${input.toMonth}:${input.departmentId ?? "all"}`,
      summary: `DA arrears of ${input.percent}% for ${toCreate.length} employee(s), ${input.fromMonth}/${input.fromYear} to ${input.toMonth}/${input.toYear}: ${total}`,
      details: [
        { label: "Kind", value: "DA arrears" },
        { label: "DA increase", value: `${input.percent}% of basic` },
        { label: "Months", value: `${input.fromMonth}/${input.fromYear} to ${input.toMonth}/${input.toYear}` },
        { label: "Employees", value: String(toCreate.length) },
        { label: "Total", value: total },
        { label: "Reason", value: input.reason },
      ],
      amount: total,
      payload: { kind: "DA", input },
    });
    if (held) return { ...held, committed: false, rows, total };
  }
  if (input.commit && toCreate.length > 0) {
    await PayrollArrear.insertMany(
      toCreate.map((r) => ({
        businessId: ctx.businessId,
        employeeId: new Types.ObjectId(r.employeeId),
        kind: "DA",
        fromYear: input.fromYear,
        fromMonth: input.fromMonth,
        toYear: input.toYear,
        toMonth: input.toMonth,
        percent: input.percent,
        amount: toDecimal128(new Decimal(r.amount)),
        breakdown: [{ code: "BASIC", label: `DA ${input.percent}% of basic ${r.basic}`, amount: toDecimal128(new Decimal(r.amount)) }],
        reason: input.reason,
        createdBy: ctx.userId,
      }))
    );
    await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.payroll", documentType: "PayrollArrear", newValue: { kind: "DA", percent: input.percent, from: `${input.fromMonth}/${input.fromYear}`, to: `${input.toMonth}/${input.toYear}`, employees: toCreate.length }, reason: input.reason });
  }
  return {
    committed: input.commit && toCreate.length > 0,
    rows,
    total: toCreate.reduce((t, r) => t.plus(r.amount), new Decimal(0)).toFixed(2),
  };
}

/* ------------------------------------------------------------------ */
/* List / cancel                                                       */
/* ------------------------------------------------------------------ */

export const arrearListSchema = z.object({
  kind: z.enum(["INCREMENT", "DAY", "DA"]).optional(),
  status: z.enum(["PENDING", "INCLUDED", "CANCELLED"]).optional(),
});

export async function listArrears(ctx: AuthContext, params: z.infer<typeof arrearListSchema>) {
  const filter: Record<string, unknown> = { businessId: ctx.businessId };
  if (params.kind) filter.kind = params.kind;
  if (params.status) filter.status = params.status;
  const rows = await PayrollArrear.find(filter).sort({ createdAt: -1 }).limit(500).lean<AnyDoc[]>();
  const [labels, runs] = await Promise.all([
    employeeLabels(ctx.businessId, rows.map((r) => r.employeeId)),
    PayrollRun.find({ businessId: ctx.businessId, _id: { $in: rows.map((r) => r.payrollRunId).filter(Boolean) } }, { runNumber: 1 }).lean<AnyDoc[]>(),
  ]);
  const runNo = new Map(runs.map((r) => [String(r._id), r.runNumber as string]));
  const pending = rows.filter((r) => r.status === "PENDING");
  return {
    items: rows.map((r) => {
      const e = labels.get(String(r.employeeId));
      return {
        id: String(r._id),
        kind: r.kind,
        employeeId: String(r.employeeId),
        employeeName: e?.name ?? "—",
        employeeCode: e?.code ?? "",
        from: { year: r.fromYear, month: r.fromMonth },
        to: { year: r.toYear, month: r.toMonth },
        days: r.days ?? null,
        percent: r.percent ?? null,
        amount: d(r.amount).toFixed(2),
        breakdown: (r.breakdown ?? []).map((b: AnyDoc) => ({ code: b.code, label: b.label, amount: d(b.amount).toFixed(2) })),
        reason: r.reason,
        status: r.status,
        paidIn: r.payrollRunId ? { id: String(r.payrollRunId), runNumber: runNo.get(String(r.payrollRunId)) ?? "" } : null,
        createdAt: r.createdAt,
      };
    }),
    pendingTotal: pending.reduce((t, r) => t.plus(d(r.amount)), new Decimal(0)).toFixed(2),
    pendingCount: pending.length,
  };
}

/** Cancels a pending arrear (increment arrears go with their revision, from the History tab). */
export async function cancelArrear(ctx: AuthContext, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Arrear not found");
  const a = await PayrollArrear.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!a) throw AppError.notFound("Arrear not found");
  if (a.status !== "PENDING") throw AppError.badRequest("Only a pending arrear can be cancelled.", "ARREAR_NOT_PENDING");
  if (a.kind === "INCREMENT") throw AppError.badRequest("Increment arrears follow their salary revision: remove the revision on the employee's History tab.", "USE_HISTORY");
  await PayrollArrear.updateOne({ _id: a._id, businessId: ctx.businessId }, { status: "CANCELLED" });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CANCEL", module: "hr.payroll", documentType: "PayrollArrear", documentId: a._id, oldValue: { kind: a.kind, amount: d(a.amount).toFixed(2) } });
  return { id, status: "CANCELLED" };
}

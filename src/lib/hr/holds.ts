import { Types, type ClientSession } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { PayrollHold, PayrollRun, FnfSettlement } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { monthRange, employeesDuring } from "./calendar";
import { assertPayrollOpen, type ApprovedRun } from "./attendance";
import { holdForApproval } from "@/lib/approvals/service";
import { findEmployee, employeeLabels, monthQuery, objectId, type AnyDoc } from "./common";

/*
 * Block / unblock payroll: a salary hold keeps an employee out of a month's
 * payroll (no payslip, nothing in the bank sheet) until it is lifted. Holds
 * can't change once the month's payroll is approved; with a draft run, the
 * draft must be recalculated (approval refuses it until then).
 */

/** Ids of employees whose salary is on hold for the month. */
export async function heldEmployeeIds(businessId: Types.ObjectId, year: number, month: number, session?: ClientSession): Promise<Set<string>> {
  const q = PayrollHold.find({ businessId, year, month }, { employeeId: 1 });
  const rows = await (session ? q.session(session) : q).lean<AnyDoc[]>();
  return new Set(rows.map((r) => String(r.employeeId)));
}

/** Employees a month's payroll covers: on the rolls during the month and not on hold. */
export async function payrollEmployees(businessId: Types.ObjectId, year: number, month: number, session?: ClientSession): Promise<AnyDoc[]> {
  const { start, end } = monthRange(year, month);
  const [emps, held, settled] = await Promise.all([employeesDuring(businessId, start, end), heldEmployeeIds(businessId, year, month, session), settledEmployeeIds(businessId, year, month, session)]);
  return emps.filter((e) => !held.has(String(e._id)) && !settled.has(String(e._id)));
}

/** Employees whose approved full & final settlement already pays this month's salary. */
export async function settledEmployeeIds(businessId: Types.ObjectId, year: number, month: number, session?: ClientSession): Promise<Set<string>> {
  const q = FnfSettlement.find(
    { businessId, status: { $in: ["APPROVED", "PAID"] }, $or: [{ salaryFromYear: { $lt: year } }, { salaryFromYear: year, salaryFromMonth: { $lte: month } }] },
    { employeeId: 1 }
  );
  const rows = await (session ? q.session(session) : q).lean<AnyDoc[]>();
  return new Set(rows.map((r) => String(r.employeeId)));
}

export const holdSchema = monthQuery.extend({
  employeeId: objectId,
  reason: z.string().trim().min(3, "Give a reason for the hold").max(300),
});

async function assertMonthOpen(businessId: Types.ObjectId, year: number, month: number) {
  await assertPayrollOpen(businessId, [monthRange(year, month).start]).catch((err) => {
    if (err instanceof AppError && err.code === "PAYROLL_LOCKED") {
      throw AppError.badRequest("That month's payroll is already approved. Roll it back first to change holds.", "PAYROLL_LOCKED");
    }
    throw err;
  });
}

async function draftRunId(businessId: Types.ObjectId, year: number, month: number): Promise<string | null> {
  const run = await PayrollRun.findOne({ businessId, year, month, status: "DRAFT" }, { _id: 1 }).lean<AnyDoc>();
  return run ? String(run._id) : null;
}

export async function listHolds(ctx: AuthContext, year: number, month: number) {
  const [rows, locked, draft] = await Promise.all([
    PayrollHold.find({ businessId: ctx.businessId, year, month }).sort({ createdAt: -1 }).lean<AnyDoc[]>(),
    PayrollRun.exists({ businessId: ctx.businessId, year, month, status: { $in: ["APPROVED", "PAID"] } }),
    draftRunId(ctx.businessId, year, month),
  ]);
  const labels = await employeeLabels(ctx.businessId, rows.map((r) => r.employeeId));
  const { start, end } = monthRange(year, month);
  const employees = await employeesDuring(ctx.businessId, start, end);
  const heldIds = new Set(rows.map((r) => String(r.employeeId)));
  return {
    year,
    month,
    locked: Boolean(locked),
    draftRunId: draft,
    items: rows.map((r) => {
      const e = labels.get(String(r.employeeId));
      return { id: String(r._id), employeeId: String(r.employeeId), employeeName: e?.name ?? "—", employeeCode: e?.code ?? "", department: e?.department ?? "", reason: r.reason, createdAt: r.createdAt };
    }),
    /** Who can still be put on hold this month. */
    candidates: employees.filter((e) => !heldIds.has(String(e._id))).map((e) => ({ id: String(e._id), name: e.name, code: e.employeeCode })),
  };
}

/** Puts an employee's salary for a month on hold. */
export async function blockPayroll(ctx: AuthContext, input: z.infer<typeof holdSchema>, opts: ApprovedRun = {}) {
  const emp = await findEmployee(ctx.businessId, input.employeeId);
  const { start, end } = monthRange(input.year, input.month);
  const onRolls = (await employeesDuring(ctx.businessId, start, end)).some((e) => String(e._id) === String(emp._id));
  if (!onRolls) throw AppError.badRequest(`${emp.name} is not on the rolls that month.`, "EMPLOYEE_NOT_EMPLOYED");
  await assertMonthOpen(ctx.businessId, input.year, input.month);
  if (await PayrollHold.exists({ businessId: ctx.businessId, employeeId: emp._id, year: input.year, month: input.month })) {
    throw AppError.conflict(`${emp.name}'s salary is already on hold for that month.`, "ALREADY_HELD");
  }
  if (!opts.approved) {
    const held = await holdForApproval(ctx, {
      document: "hr-payroll-hold",
      targetKey: `payroll-hold:${emp._id}:${input.year}-${input.month}`,
      recordId: emp._id,
      number: emp.employeeCode,
      summary: `Block ${emp.employeeCode} ${emp.name}'s salary for ${input.month}/${input.year}`,
      details: [{ label: "Employee", value: `${emp.employeeCode} ${emp.name}` }, { label: "Month", value: `${input.month}/${input.year}` }, { label: "Action", value: "Block salary" }, { label: "Reason", value: input.reason ?? "" }],
      employeeId: emp._id,
      payload: { op: "block", input },
    });
    if (held) return held;
  }
  const doc = await PayrollHold.create({ businessId: ctx.businessId, employeeId: emp._id, year: input.year, month: input.month, reason: input.reason, createdBy: ctx.userId });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "CREATE", module: "hr.payroll", documentType: "PayrollHold", documentId: doc._id, newValue: { employee: emp.employeeCode, month: input.month, year: input.year }, reason: input.reason });
  return { id: String(doc._id), draftRunId: await draftRunId(ctx.businessId, input.year, input.month) };
}

/** Lifts a hold so the employee is paid with the month's payroll again. */
export async function unblockPayroll(ctx: AuthContext, id: string, opts: ApprovedRun = {}) {
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Hold not found");
  const hold = await PayrollHold.findOne({ _id: id, businessId: ctx.businessId }).lean<AnyDoc>();
  if (!hold) throw AppError.notFound("Hold not found");
  await assertMonthOpen(ctx.businessId, hold.year, hold.month);
  if (!opts.approved) {
    const emp = await findEmployee(ctx.businessId, String(hold.employeeId));
    const held = await holdForApproval(ctx, {
      document: "hr-payroll-hold",
      targetKey: `payroll-hold:${hold.employeeId}:${hold.year}-${hold.month}`,
      recordId: emp._id,
      number: emp.employeeCode,
      summary: `Unblock ${emp.employeeCode} ${emp.name}'s salary for ${hold.month}/${hold.year}`,
      details: [{ label: "Employee", value: `${emp.employeeCode} ${emp.name}` }, { label: "Month", value: `${hold.month}/${hold.year}` }, { label: "Action", value: "Unblock salary" }, { label: "Blocked because", value: hold.reason ?? "" }],
      employeeId: emp._id,
      payload: { op: "unblock", id },
    });
    if (held) return held;
  }
  await PayrollHold.deleteOne({ _id: hold._id, businessId: ctx.businessId });
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "DELETE", module: "hr.payroll", documentType: "PayrollHold", documentId: hold._id, oldValue: { employeeId: String(hold.employeeId), month: hold.month, year: hold.year, reason: hold.reason } });
  return { id, draftRunId: await draftRunId(ctx.businessId, hold.year, hold.month) };
}

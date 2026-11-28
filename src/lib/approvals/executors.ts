import { AppError } from "@/lib/errors/AppError";
import type { AuthContext } from "@/lib/auth/context";
import { getResource } from "@/lib/resources/registry";
import { createResourceRecord, updateResourceRecord, deleteResourceRecord } from "@/lib/resources/handlers";
import { commitImport } from "@/lib/import/service";
import { saveDailySheet, saveEmployeeMonth, saveSheetSchema, saveMonthSchema } from "@/lib/hr/attendance";
import { cancelLeave, setAllocation, allocationSchema, carryForwardLeave, carryForwardSchema } from "@/lib/hr/leave";
import { recordChange, deleteChange, changeSchema } from "@/lib/hr/history";
import { assignShift, shiftAssignSchema } from "@/lib/hr/shiftAssign";
import { assignCalendar, assignSchema } from "@/lib/hr/holidayCalendars";
import { markRunPaid, cancelRun, payRunSchema } from "@/lib/hr/payroll";
import { saveVariables, saveSchema } from "@/lib/hr/variables";
import { postIncentive, incentiveQuery } from "@/lib/hr/incentive";
import { blockPayroll, unblockPayroll, holdSchema } from "@/lib/hr/holds";
import { createDayArrear, createDaArrears, dayArrearSchema, daArrearSchema } from "@/lib/hr/arrears";
import { settleClaims, claimSettlementSchema, createLoan, loanCreateSchema, recordRepayment, repaymentSchema, adjustClaimsAgainstAdvance, adjustClaimsSchema } from "@/lib/hr/money";
import { allocateAsset, allocateSchema, returnAsset, returnSchema } from "@/lib/hr/assets";
import { saveLabourSheet, saveLabourSheetSchema } from "@/lib/hr/contractLabour";
import { saveSettingsSection } from "./settingsApprovals";
import { SETTINGS_SECTIONS } from "@/lib/settings/definitions";
import { createPayment } from "@/lib/payments/service";
import { getPaymentType, paymentCreateSchema } from "@/lib/payments/types";
import { createExpense, expenseCreateSchema } from "@/lib/expenses/service";
import { createVoucher, voucherCreateSchema } from "@/lib/accounting/voucherService";
import { createAdjustment, adjustmentCreateSchema } from "@/lib/inventory/stockDocumentService";
import { isHeld } from "./catalog";
import type { ActionRunner } from "./service";

/*
 * What each held action does once its last stage approves: the module's own
 * function, called with `approved: true` so it is not held again, re-checking
 * everything against the data as it is now. One entry per action document in
 * catalog.ts. The approver's context is used, with the operation's
 * permission added for that one call (the approval screens have already
 * checked they are the current stage's approver).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;
const APPROVED = { approved: true } as const;

/** The approver may not hold the module permission themselves; the scheme made them the approver. */
export function withPermissions(ctx: AuthContext, extra: (string | undefined)[]): AuthContext {
  return { ...ctx, permissions: [...new Set([...ctx.permissions, ...(extra.filter(Boolean) as string[])])] };
}

/** A module that would hold again means the scheme changed mid-way; never loop. */
function done<T>(r: T): T {
  if (isHeld(r)) throw AppError.conflict("The change was sent for approval again instead of being applied. Refresh and try again.", "APPROVAL_LOOP");
  return r;
}

async function runResource(ctx: AuthContext, p: AnyDoc): Promise<string> {
  const def = getResource(String(p?.resource ?? ""));
  if (!def) throw AppError.notFound("That kind of record no longer exists");
  const c = withPermissions(ctx, [def.permissions.create, def.permissions.edit, def.permissions.delete]);
  switch (p.op) {
    case "create":
      done(await createResourceRecord(def, c, p.body, APPROVED));
      return `${def.label} created`;
    case "update":
      done(await updateResourceRecord(def, c, String(p.id), p.body, { approved: true, baseUpdatedAt: p.baseUpdatedAt }));
      return `${def.label} updated`;
    case "delete":
      done(await deleteResourceRecord(def, c, String(p.id), APPROVED));
      return `${def.label} deleted`;
    case "import": {
      const r = await commitImport(def.key, p.sheet, c, { skipDuplicates: Boolean(p.skipDuplicates) });
      return `${r.imported} record(s) imported${r.skippedDuplicates ? `, ${r.skippedDuplicates} duplicate(s) skipped` : ""}`;
    }
    default:
      throw AppError.badRequest("Unknown change", "BAD_PAYLOAD");
  }
}

/** Employee documents: a form write (resource) or a dated change in employment history. */
async function runEmployee(ctx: AuthContext, p: AnyDoc): Promise<string> {
  if (p?.resource) return runResource(ctx, p);
  const c = withPermissions(ctx, ["hr-employees.edit"]);
  if (p.op === "delete") {
    done(await deleteChange(c, String(p.employeeId), String(p.changeId), APPROVED));
    return "Change removed from employment history";
  }
  const r = done(await recordChange(c, String(p.employeeId), changeSchema.parse(p.input), APPROVED));
  return "scheduled" in r && r.scheduled ? `Change scheduled from ${r.effectiveDate}` : "Change recorded";
}

/** Holiday documents: master writes or calendar assignment. */
async function runHoliday(ctx: AuthContext, p: AnyDoc): Promise<string> {
  if (p?.resource) return runResource(ctx, p);
  const r = done(await assignCalendar(withPermissions(ctx, ["hr-holidays.edit", "hr-employees.edit"]), assignSchema.parse(p.input), APPROVED));
  return `${"updated" in r ? r.updated : 0} employee(s) moved to ${"calendar" in r && r.calendar ? r.calendar : "the default calendar"}`;
}

/** Payroll setup: master writes or a settings section. */
async function runPayrollSetup(ctx: AuthContext, p: AnyDoc): Promise<string> {
  if (p?.resource) return runResource(ctx, p);
  await saveSettingsSection(withPermissions(ctx, [SETTINGS_SECTIONS[String(p.section)]?.editPermission]), String(p.section), p.input, APPROVED);
  return "Settings saved";
}

export const ACTION_EXECUTORS: Record<string, ActionRunner> = {
  "hr-employee-create": (ctx, p) => runResource(ctx, p),
  "hr-employee-update": runEmployee,
  "hr-transfer": runEmployee,
  "hr-department-change": runEmployee,
  "hr-designation-change": runEmployee,
  "hr-promotion": runEmployee,
  "hr-salary-revision": runEmployee,
  "hr-resignation": runEmployee,
  "hr-termination": runEmployee,

  "hr-attendance-daily": async (ctx, p) => {
    const r = done(await saveDailySheet(ctx, saveSheetSchema.parse(p), APPROVED));
    return `${"saved" in r ? r.saved : 0} employee(s) saved${"skipped" in r && r.skipped ? `, ${r.skipped} on leave left alone` : ""}`;
  },
  "hr-attendance-monthly": async (ctx, p) => {
    const r = done(await saveEmployeeMonth(ctx, saveMonthSchema.parse(p), APPROVED));
    return `${"saved" in r ? r.saved : 0} day(s) saved`;
  },
  "hr-regularization-policy": async (ctx, p) => {
    await saveSettingsSection(withPermissions(ctx, [SETTINGS_SECTIONS[String(p.section)]?.editPermission]), String(p.section), p.input, APPROVED);
    return "Regularization policy saved";
  },
  "hr-leave-cancel": async (ctx, p) => {
    done(await cancelLeave(ctx, String(p.id), { self: false, note: String(p.note ?? ""), approved: true }));
    return "Leave cancelled and its days cleared";
  },
  "hr-leave-balance": async (ctx, p) => {
    if (p && "fromYear" in p) {
      const r = done(await carryForwardLeave(ctx, carryForwardSchema.parse(p), APPROVED));
      return `Carried forward into ${r.toYear}: ${r.totals.carried} day(s)`;
    }
    done(await setAllocation(ctx, allocationSchema.parse(p), APPROVED));
    return "Leave allocation saved";
  },
  "hr-shift-assign": async (ctx, p) => {
    const r = done(await assignShift(ctx, p.target, shiftAssignSchema.parse(p.input), APPROVED));
    return `${"updated" in r ? r.updated : 0} moved to ${"shift" in r && r.shift ? r.shift : "the default shift"}`;
  },
  "hr-shift-change": (ctx, p) => runResource(ctx, p),
  "hr-holiday-change": runHoliday,

  "hr-payroll-disburse": async (ctx, p) => {
    done(await markRunPaid(ctx, String(p.id), payRunSchema.parse(p.input), APPROVED));
    return "Payroll marked paid; payslips released";
  },
  "hr-payroll-rollback": async (ctx, p) => {
    done(await cancelRun(ctx, String(p.id), String(p.reason ?? ""), APPROVED));
    return "Payroll rolled back";
  },
  "hr-variable-earning": async (ctx, p) => {
    const r = done(await saveVariables(ctx, saveSchema.parse(p), APPROVED));
    return `${"saved" in r ? r.saved : 0} amount(s) saved`;
  },
  "hr-variable-deduction": async (ctx, p) => {
    const r = done(await saveVariables(ctx, saveSchema.parse(p), APPROVED));
    return `${"saved" in r ? r.saved : 0} amount(s) saved`;
  },
  "hr-incentive": async (ctx, p) => {
    const r = done(await postIncentive(ctx, incentiveQuery.parse(p), APPROVED));
    return "added" in r ? `Added to ${r.payout} payroll for ${r.added} employee(s)` : "Added to payroll";
  },
  "hr-payroll-hold": async (ctx, p) => {
    if (p.op === "unblock") {
      done(await unblockPayroll(ctx, String(p.id), APPROVED));
      return "Salary released";
    }
    done(await blockPayroll(ctx, holdSchema.parse(p.input), APPROVED));
    return "Salary put on hold";
  },
  "hr-arrear": async (ctx, p) => {
    if (p.kind === "DA") {
      const r = done(await createDaArrears(ctx, daArrearSchema.parse(p.input), APPROVED));
      return `DA arrears added for ${"rows" in r ? r.rows.filter((x) => !x.skipped).length : 0} employee(s)`;
    }
    const r = done(await createDayArrear(ctx, dayArrearSchema.parse(p.input), APPROVED));
    return `Day arrear of ${"amount" in r ? r.amount : ""} added to the next payroll`;
  },
  "hr-payroll-setup": runPayrollSetup,

  "hr-claim-settlement": async (ctx, p) => {
    const r = done(await settleClaims(ctx, claimSettlementSchema.parse(p), APPROVED));
    return "payroll" in r && r.payroll ? `${r.scheduled} claim(s) to be paid in ${r.payroll} payroll` : `${"settled" in r ? r.settled : 0} claim(s) settled`;
  },
  "hr-advance-issue": async (ctx, p) => {
    const r = done(await createLoan(ctx, loanCreateSchema.parse(p), APPROVED));
    return `Advance ${"loanNumber" in r ? r.loanNumber : ""} issued`;
  },
  "hr-advance-settlement": async (ctx, p) => {
    if (p.op === "adjust") {
      done(await adjustClaimsAgainstAdvance(ctx, String(p.id), adjustClaimsSchema.parse(p.input), APPROVED));
      return "Claims set off against the advance";
    }
    done(await recordRepayment(ctx, String(p.id), repaymentSchema.parse(p.input), APPROVED));
    return "Repayment recorded";
  },
  "hr-asset-allocation": async (ctx, p) => {
    const r = done(await allocateAsset(ctx, allocateSchema.parse(p), APPROVED));
    return `Asset allocated (${"allocationNumber" in r ? r.allocationNumber : ""})`;
  },
  "hr-asset-return": async (ctx, p) => {
    done(await returnAsset(ctx, String(p.id), returnSchema.parse(p.input), APPROVED));
    return "Asset return recorded";
  },
  "hr-labour-attendance": async (ctx, p) => {
    const r = done(await saveLabourSheet(ctx, saveLabourSheetSchema.parse(p), APPROVED));
    return `${"saved" in r ? r.saved : 0} worker(s) saved`;
  },
  "hr-job-opening": (ctx, p) => runResource(ctx, p),
  "hr-appraisal": (ctx, p) => runResource(ctx, p),

  "erp-receipt": async (ctx, p) => {
    const type = getPaymentType("receipts");
    if (!type) throw AppError.notFound("Unknown payment type");
    const r = done(await createPayment(type, paymentCreateSchema.parse(p.input), withPermissions(ctx, [type.permissions.create]), APPROVED));
    return `Receipt ${(r as AnyDoc).documentNumber ?? ""} recorded`;
  },
  "erp-payment": async (ctx, p) => {
    const type = getPaymentType("payments");
    if (!type) throw AppError.notFound("Unknown payment type");
    const r = done(await createPayment(type, paymentCreateSchema.parse(p.input), withPermissions(ctx, [type.permissions.create]), APPROVED));
    return `Payment ${(r as AnyDoc).documentNumber ?? ""} recorded`;
  },
  "erp-expense": async (ctx, p) => {
    const r = done(await createExpense(expenseCreateSchema.parse(p), ctx, APPROVED));
    return `Expense ${(r as AnyDoc).documentNumber ?? ""} recorded`;
  },
  "erp-journal": async (ctx, p) => {
    const r = done(await createVoucher(voucherCreateSchema.parse(p), ctx, APPROVED));
    return `Voucher ${(r as AnyDoc).voucherNumber ?? (r as AnyDoc).documentNumber ?? ""} posted`;
  },
  "erp-stock-adjustment": async (ctx, p) => {
    const r = done(await createAdjustment(adjustmentCreateSchema.parse(p), ctx, APPROVED));
    return `Stock adjustment ${(r as AnyDoc).documentNumber ?? ""} posted`;
  },
};

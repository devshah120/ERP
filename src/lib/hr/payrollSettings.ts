import { Types } from "mongoose";
import Decimal from "decimal.js";
import { AppError } from "@/lib/errors/AppError";
import { getSettings } from "@/lib/settings/service";
import type { HrPayrollSettings, HrPfSettings, HrEsicSettings } from "@/lib/settings/definitions";
import { SalaryStructure, PtSlab } from "@/models/hr";
import type { AuthContext } from "@/lib/auth/context";
import type { StatutoryRules } from "./payrollMath";
import { splitSalary, monthlyGrossFrom, structureProblems, type StructureLine } from "./salaryStructureMath";
import type { AnyDoc } from "./common";

/*
 * HR Settings → payroll: reads Payroll / PF / ESIC Settings and the PT slabs
 * for payroll, and splits an employee's salary amount by their structure.
 */

export const getPayrollSettings = (businessId: Types.ObjectId) => getSettings<HrPayrollSettings>(businessId, "hr-payroll-settings");

const pct = (v: number) => new Decimal(v || 0).div(100);

/** PF, ESI and PT rules for computePayslip, from the workspace's settings. */
export async function statutoryRules(businessId: Types.ObjectId): Promise<StatutoryRules> {
  const [pf, esi, slabs] = await Promise.all([
    getSettings<HrPfSettings>(businessId, "hr-pf-settings"),
    getSettings<HrEsicSettings>(businessId, "hr-esic-settings"),
    PtSlab.find({ businessId, deletedAt: null, status: "ACTIVE" }).sort({ minGross: 1 }).lean<AnyDoc[]>(),
  ]);
  const str = (v: unknown) => (v ? String(v) : "0");
  return {
    pfEnabled: pf.pfApplicable,
    pfEmployeeRate: pct(pf.employeeRate),
    pfEmployerRate: pct(pf.employerRate),
    pfWageCeiling: new Decimal(pf.wageCeiling || 0),
    pfCapAtCeiling: pf.capAtCeiling,
    esiEnabled: esi.esicApplicable,
    esiGrossLimit: new Decimal(esi.grossLimit || 0),
    esiEmployeeRate: pct(esi.employeeRate),
    esiEmployerRate: pct(esi.employerRate),
    ptSlabs: slabs.map((s) => ({ minGross: str(s.minGross), maxGross: str(s.maxGross), amount: str(s.amount), februaryAmount: str(s.februaryAmount) })),
  };
}

/**
 * Employee form, before saving: when a salary structure and an amount are
 * set (in this edit or already on the record), works basic, HRA, conveyance,
 * special and other allowance out from them, replacing whatever was typed in
 * those heads. Also enforces Payroll Settings' mandatory fields. Mutates
 * `input` (the validated form values, money as strings).
 */
export async function prepareEmployeeSalary(ctx: AuthContext, input: Record<string, unknown>, before?: AnyDoc): Promise<void> {
  const settings = await getPayrollSettings(ctx.businessId);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  const value = (k: string) => (has(k) ? input[k] : before?.[k]);

  const missing = (k: string) => !value(k) || String(value(k)) === "";
  if (settings.departmentMandatory && missing("departmentId")) {
    throw AppError.badRequest("Department is mandatory (Payroll Settings)", "VALIDATION_ERROR", [{ path: ["departmentId"], message: "Choose a department" }]);
  }
  if (settings.reportingManagerMandatory && missing("reportingManagerId")) {
    throw AppError.badRequest("Reporting manager is mandatory (Payroll Settings)", "VALIDATION_ERROR", [{ path: ["reportingManagerId"], message: "Choose who this employee reports to" }]);
  }

  // Only re-split when the structure or amount is part of this save.
  if (!has("salaryStructureId") && !has("salaryAmount")) return;
  const structureId = value("salaryStructureId") ? String(value("salaryStructureId")) : "";
  const amount = new Decimal(value("salaryAmount") ? String(value("salaryAmount")) : "0");
  if (!structureId) return;
  if (!Types.ObjectId.isValid(structureId)) throw AppError.badRequest("Choose a salary structure", "VALIDATION_ERROR", [{ path: ["salaryStructureId"], message: "Choose a salary structure" }]);
  if (amount.lte(0)) {
    throw AppError.badRequest("Enter the salary amount for the structure to split", "VALIDATION_ERROR", [{ path: ["salaryAmount"], message: "Enter the salary amount" }]);
  }

  const structure = await SalaryStructure.findOne({ _id: structureId, businessId: ctx.businessId, deletedAt: null }).lean<AnyDoc>();
  if (!structure) throw AppError.badRequest("Salary structure not found", "VALIDATION_ERROR", [{ path: ["salaryStructureId"], message: "Salary structure not found" }]);
  const lines = (structure.lines ?? []) as StructureLine[];
  const problems = structureProblems(lines);
  if (problems.length > 0) throw AppError.badRequest(`Salary structure ${structure.code} can't be used: ${problems[0][1]}`, "STRUCTURE_INVALID");

  let split;
  try {
    split = splitSalary(lines, monthlyGrossFrom(amount, settings.salaryAmountBasis), structure.roundingDecimals ?? 0);
  } catch (err) {
    throw AppError.badRequest(err instanceof Error ? err.message : "The amount can't be split", "VALIDATION_ERROR", [{ path: ["salaryAmount"], message: "Too small for this structure's fixed heads" }]);
  }
  input.basic = split.basic.toFixed(2);
  input.hra = split.hra.toFixed(2);
  input.conveyance = split.conveyance.toFixed(2);
  input.specialAllowance = split.specialAllowance.toFixed(2);
  input.otherAllowance = split.otherAllowance.toFixed(2);
}

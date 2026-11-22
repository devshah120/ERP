import { Types, type ClientSession } from "mongoose";
import Decimal from "decimal.js";
import ExcelJS from "exceljs";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { PayComponent, PayrollVariable, PayrollRun, Employee, HrDepartment, Designation } from "@/models/hr";
import { Branch } from "@/models/Branch";
import { recordAudit } from "@/lib/services/auditService";
import { toDecimal128 } from "@/lib/documents/decimal128";
import type { ParsedSheet } from "@/lib/import/service";
import type { AuthContext } from "@/lib/auth/context";
import { monthRange, employeesDuring } from "./calendar";
import { assertPayrollOpen } from "./attendance";
import { employeeLabels, escapeRegex, monthQuery, objectId, type AnyDoc } from "./common";

/*
 * Variable pay ("variable others"): one-off amounts per employee per month
 * for components such as bonus, incentive, overtime or canteen recovery.
 * Entered on a grid or imported from Excel; payroll adds earnings to gross
 * and takes deductions after tax, without loss-of-pay proration.
 */

export const DEFAULT_PAY_COMPONENTS = [
  { code: "BONUS", name: "Bonus", kind: "EARNING", esiApplicable: false, description: "Annual or festival bonus (kept out of ESI wages)." },
  { code: "INCENTIVE", name: "Incentive", kind: "EARNING", esiApplicable: true },
  { code: "OT", name: "Overtime pay", kind: "EARNING", esiApplicable: true },
  { code: "ARREAR", name: "Arrears", kind: "EARNING", esiApplicable: true },
  { code: "CANTEEN", name: "Canteen recovery", kind: "DEDUCTION", esiApplicable: false },
  { code: "OTHER_DED", name: "Other deduction", kind: "DEDUCTION", esiApplicable: false },
] as const;

/** Seeds the common components the first time a workspace uses variable pay. */
export async function ensurePayComponents(businessId: Types.ObjectId): Promise<void> {
  if ((await PayComponent.countDocuments({ businessId, deletedAt: null })) > 0) return;
  await PayComponent.create(DEFAULT_PAY_COMPONENTS.map((c) => ({ businessId, ...c })), { ordered: true });
}

const amountText = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(/,/g, ""))
  .refine((v) => v === "" || /^\d+(\.\d{1,2})?$/.test(v), "Use an amount like 1500 or 1500.50");

/** The month's variable lines per employee, for payroll. */
export async function monthVariables(businessId: Types.ObjectId, year: number, month: number, employeeIds: Types.ObjectId[], session?: ClientSession) {
  const q = PayrollVariable.find({ businessId, year, month, employeeId: { $in: employeeIds } });
  const rows = await (session ? q.session(session) : q).lean<AnyDoc[]>();
  const comps = await PayComponent.find({ businessId, _id: { $in: rows.map((r) => r.componentId) } }).lean<AnyDoc[]>();
  const compBy = new Map(comps.map((c) => [String(c._id), c]));
  const out = new Map<string, { code: string; label: string; kind: "EARNING" | "DEDUCTION"; amount: string; esiApplicable: boolean }[]>();
  for (const r of rows) {
    const c = compBy.get(String(r.componentId));
    if (!c) continue;
    const k = String(r.employeeId);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ code: c.code, label: c.name, kind: c.kind, amount: new Decimal(String(r.amount)).toFixed(2), esiApplicable: c.esiApplicable !== false });
  }
  for (const list of out.values()) list.sort((a, b) => a.code.localeCompare(b.code));
  return out;
}

/** "BONUS:1000.00|OT:250.00" — compared at approval to spot variable pay changed after the draft. */
export function variableKey(lines: { code: string; amount: string }[] | undefined): string {
  return (lines ?? [])
    .filter((l) => new Decimal(l.amount).gt(0))
    .map((l) => `${l.code}:${new Decimal(l.amount).toFixed(2)}`)
    .sort()
    .join("|");
}

/* ------------------------------------------------------------------ */
/* Grid                                                                */
/* ------------------------------------------------------------------ */

export const sheetSchema = monthQuery.extend({
  departmentId: z.string().trim().optional(),
  designationId: z.string().trim().optional(),
  branchId: z.string().trim().optional(),
  query: z.string().trim().max(100).optional(),
  /** Comma-separated component ids; default all active. */
  components: z.string().trim().optional(),
});

async function monthState(businessId: Types.ObjectId, year: number, month: number) {
  const [locked, draft] = await Promise.all([
    PayrollRun.exists({ businessId, year, month, status: { $in: ["APPROVED", "PAID"] } }),
    PayrollRun.findOne({ businessId, year, month, status: "DRAFT" }, { _id: 1, runNumber: 1 }).lean<AnyDoc>(),
  ]);
  return { locked: Boolean(locked), draftRun: draft ? { id: String(draft._id), runNumber: draft.runNumber as string } : null };
}

/** Employees on the rolls in the month × chosen components, with the amounts entered so far. */
export async function variableSheet(ctx: AuthContext, params: z.infer<typeof sheetSchema>) {
  await ensurePayComponents(ctx.businessId);
  const { start, end } = monthRange(params.year, params.month);
  const wanted = (params.components ?? "").split(",").filter((x) => Types.ObjectId.isValid(x));
  const [allComponents, departments, designations, branches, state] = await Promise.all([
    PayComponent.find({ businessId: ctx.businessId, deletedAt: null, status: "ACTIVE" }).sort({ kind: -1, code: 1 }).lean<AnyDoc[]>(),
    HrDepartment.find({ businessId: ctx.businessId, deletedAt: null }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Designation.find({ businessId: ctx.businessId, deletedAt: null }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Branch.find({ businessId: ctx.businessId }, { name: 1 }).sort({ name: 1 }).lean<AnyDoc[]>(),
    monthState(ctx.businessId, params.year, params.month),
  ]);
  const components = wanted.length > 0 ? allComponents.filter((c) => wanted.includes(String(c._id))) : allComponents;

  let emps = await employeesDuring(ctx.businessId, start, end);
  const eq = (field: string, v?: string) => (v && Types.ObjectId.isValid(v) ? (e: AnyDoc) => String(e[field] ?? "") === v : null);
  for (const f of [eq("departmentId", params.departmentId), eq("designationId", params.designationId), eq("branchId", params.branchId)]) if (f) emps = emps.filter(f);
  if (params.query) {
    const rx = new RegExp(escapeRegex(params.query), "i");
    emps = emps.filter((e) => rx.test(e.name) || rx.test(e.employeeCode));
  }

  const ids = emps.map((e) => e._id);
  const [values, labels] = await Promise.all([
    PayrollVariable.find({ businessId: ctx.businessId, year: params.year, month: params.month, employeeId: { $in: ids } }).lean<AnyDoc[]>(),
    employeeLabels(ctx.businessId, ids),
  ]);
  const amount = new Map(values.map((v) => [`${v.employeeId}:${v.componentId}`, new Decimal(String(v.amount)).toFixed(2)]));

  return {
    year: params.year,
    month: params.month,
    ...state,
    components: components.map((c) => ({ id: String(c._id), code: c.code, name: c.name, kind: c.kind })),
    allComponents: allComponents.map((c) => ({ id: String(c._id), code: c.code, name: c.name, kind: c.kind })),
    options: {
      departments: departments.map((x) => ({ id: String(x._id), name: x.name })),
      designations: designations.map((x) => ({ id: String(x._id), name: x.name })),
      branches: branches.map((x) => ({ id: String(x._id), name: x.name })),
    },
    rows: emps.map((e) => {
      const l = labels.get(String(e._id));
      return {
        employeeId: String(e._id),
        employeeCode: e.employeeCode,
        name: e.name,
        department: l?.department ?? "",
        designation: l?.designation ?? "",
        amounts: Object.fromEntries(components.map((c) => [String(c._id), amount.get(`${e._id}:${c._id}`) ?? ""])),
      };
    }),
  };
}

export const saveSchema = monthQuery.extend({
  rows: z
    .array(z.object({ employeeId: objectId, amounts: z.record(z.string(), amountText) }))
    .min(1, "Nothing to save")
    .max(2000),
});

/**
 * Saves the amounts shown on the grid: a positive amount is stored, a blank
 * or zero clears it. Refused once the month's payroll is approved.
 */
export async function saveVariables(ctx: AuthContext, input: z.infer<typeof saveSchema>) {
  const { start, end } = monthRange(input.year, input.month);
  await assertPayrollOpen(ctx.businessId, [start]).catch((err) => {
    if (err instanceof AppError && err.code === "PAYROLL_LOCKED") throw AppError.badRequest("That month's payroll is already approved, so its variable pay is locked.", "PAYROLL_LOCKED");
    throw err;
  });
  const [emps, comps] = await Promise.all([
    employeesDuring(ctx.businessId, start, end),
    PayComponent.find({ businessId: ctx.businessId, deletedAt: null }, { _id: 1 }).lean<AnyDoc[]>(),
  ]);
  const empIds = new Set(emps.map((e) => String(e._id)));
  const compIds = new Set(comps.map((c) => String(c._id)));

  const ops: AnyDoc[] = [];
  let saved = 0;
  let cleared = 0;
  for (const row of input.rows) {
    if (!empIds.has(row.employeeId)) throw AppError.badRequest("One of the employees was not on the rolls that month.", "EMPLOYEE_NOT_EMPLOYED");
    for (const [componentId, text] of Object.entries(row.amounts)) {
      if (!compIds.has(componentId)) throw AppError.badRequest("Unknown pay component.", "UNKNOWN_COMPONENT");
      const filter = { businessId: ctx.businessId, year: input.year, month: input.month, employeeId: new Types.ObjectId(row.employeeId), componentId: new Types.ObjectId(componentId) };
      const value = text === "" ? new Decimal(0) : new Decimal(text);
      if (value.gt(0)) {
        ops.push({ updateOne: { filter, update: { $set: { amount: toDecimal128(value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), updatedBy: ctx.userId }, $setOnInsert: { createdBy: ctx.userId } }, upsert: true } });
        saved += 1;
      } else {
        ops.push({ deleteOne: { filter } });
        cleared += 1;
      }
    }
  }
  if (ops.length > 0) await PayrollVariable.bulkWrite(ops);
  await recordAudit({ businessId: ctx.businessId, userId: ctx.userId, action: "UPDATE", module: "hr.payroll", documentType: "PayrollVariable", newValue: { month: input.month, year: input.year, employees: input.rows.length, amounts: saved, cleared } });
  const state = await monthState(ctx.businessId, input.year, input.month);
  return { saved, cleared, draftRun: state.draftRun };
}

/* ------------------------------------------------------------------ */
/* Excel                                                               */
/* ------------------------------------------------------------------ */

const CODE_HEADER = "Employee Code";
const NAME_HEADER = "Employee Name";

/** A template for the month: every employee on the rolls, one column per active component, current amounts filled in. */
export async function variableTemplate(ctx: AuthContext, year: number, month: number): Promise<Buffer> {
  const sheet = await variableSheet(ctx, { year, month });
  const wb = new ExcelJS.Workbook();
  const info = wb.addWorksheet("Instructions");
  info.getCell("A1").value = `Variable pay — ${month}/${year}`;
  info.getCell("A1").font = { bold: true, size: 14 };
  info.getCell("A3").value = "Enter amounts in rupees on the Data sheet. Keep the header row; columns are matched by component code.";
  info.getCell("A4").value = "A blank or 0 clears that amount for the month. Rows are matched by Employee Code; the name is for reference.";
  info.getRow(6).values = ["Code", "Component", "Type"];
  info.getRow(6).font = { bold: true };
  sheet.allComponents.forEach((c, i) => (info.getRow(7 + i).values = [c.code, c.name, c.kind === "EARNING" ? "Earning" : "Deduction"]));
  info.getColumn(1).width = 14;
  info.getColumn(2).width = 28;
  info.getColumn(3).width = 12;

  const data = wb.addWorksheet("Data");
  data.columns = [
    { header: CODE_HEADER, key: CODE_HEADER, width: 16 },
    { header: NAME_HEADER, key: NAME_HEADER, width: 28 },
    ...sheet.components.map((c) => ({ header: c.code, key: c.id, width: 14 })),
  ];
  data.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  data.getRow(1).eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3B4A6B" } }));
  data.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
  for (const r of sheet.rows) data.addRow({ [CODE_HEADER]: r.employeeCode, [NAME_HEADER]: r.name, ...Object.fromEntries(Object.entries(r.amounts).map(([id, v]) => [id, v ? Number(v) : null])) });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export interface VariableImportResult {
  rows: number;
  employees: number;
  amounts: number;
  components: string[];
  errors: { row: number; message: string }[];
  committed: boolean;
}

/**
 * Checks an uploaded sheet (Employee Code + one column per component code)
 * and, when `commit` is set and nothing is wrong, saves it like the grid.
 */
export async function importVariables(ctx: AuthContext, sheet: ParsedSheet, year: number, month: number, commit: boolean): Promise<VariableImportResult> {
  await ensurePayComponents(ctx.businessId);
  const errors: { row: number; message: string }[] = [];
  const comps = await PayComponent.find({ businessId: ctx.businessId, deletedAt: null }).lean<AnyDoc[]>();
  const compByCode = new Map(comps.map((c) => [String(c.code).toUpperCase(), c]));
  const codeHeader = sheet.headers.find((h) => h.trim().toLowerCase() === CODE_HEADER.toLowerCase());
  if (!codeHeader) return { rows: 0, employees: 0, amounts: 0, components: [], errors: [{ row: 1, message: `The sheet needs an "${CODE_HEADER}" column.` }], committed: false };

  const columns: { header: string; component: AnyDoc }[] = [];
  for (const h of sheet.headers) {
    if (h === codeHeader || h.trim().toLowerCase() === NAME_HEADER.toLowerCase()) continue;
    const c = compByCode.get(h.trim().toUpperCase());
    if (c) columns.push({ header: h, component: c });
    else errors.push({ row: 1, message: `"${h}" is not a pay component code. Add it under Pay Components or remove the column.` });
  }
  if (columns.length === 0 && errors.length === 0) errors.push({ row: 1, message: "Add at least one component column, e.g. BONUS." });

  const { start, end } = monthRange(year, month);
  const emps = await employeesDuring(ctx.businessId, start, end);
  const empByCode = new Map(emps.map((e) => [String(e.employeeCode).toUpperCase(), e]));
  const known = await Employee.find({ businessId: ctx.businessId, deletedAt: null }, { employeeCode: 1 }).lean<AnyDoc[]>();
  const anyByCode = new Set(known.map((e) => String(e.employeeCode).toUpperCase()));

  const rows: z.infer<typeof saveSchema>["rows"] = [];
  const seen = new Set<string>();
  let amounts = 0;
  for (const r of sheet.rows) {
    const code = (r.cells[codeHeader] ?? "").trim().toUpperCase();
    if (!code) {
      errors.push({ row: r.rowNumber, message: "Employee Code is blank." });
      continue;
    }
    const emp = empByCode.get(code);
    if (!emp) {
      errors.push({ row: r.rowNumber, message: anyByCode.has(code) ? `${code} was not on the rolls in ${month}/${year}.` : `No employee with code ${code}.` });
      continue;
    }
    if (seen.has(code)) {
      errors.push({ row: r.rowNumber, message: `${code} appears more than once.` });
      continue;
    }
    seen.add(code);
    const entry: Record<string, string> = {};
    for (const col of columns) {
      const raw = (r.cells[col.header] ?? "").trim().replace(/,/g, "");
      if (raw !== "" && !/^\d+(\.\d{1,2})?$/.test(raw)) {
        errors.push({ row: r.rowNumber, message: `${col.header}: "${raw}" is not an amount.` });
        continue;
      }
      entry[String(col.component._id)] = raw;
      if (raw !== "" && new Decimal(raw).gt(0)) amounts += 1;
    }
    rows.push({ employeeId: String(emp._id), amounts: entry });
  }
  if (sheet.rows.length === 0) errors.push({ row: 2, message: "The sheet has no rows." });

  const result: VariableImportResult = { rows: sheet.rows.length, employees: rows.length, amounts, components: columns.map((c) => c.component.code), errors, committed: false };
  if (commit && errors.length === 0 && rows.length > 0) {
    await saveVariables(ctx, { year, month, rows });
    result.committed = true;
  }
  return result;
}

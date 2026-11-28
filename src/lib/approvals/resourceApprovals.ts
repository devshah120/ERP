import { Types } from "mongoose";
import Decimal from "decimal.js";
import type { AuthContext } from "@/lib/auth/context";
import type { ResourceDefinition } from "@/lib/resources/types";
import { Employee, HrDepartment, Designation, HrGrade, Shift } from "@/models/hr";
import { Branch } from "@/models/Branch";
import { approvalActive, holdForApproval } from "./service";
import { approvalDocument, type HeldResult } from "./catalog";

/*
 * Which master-data writes need approval, and under which document. The
 * generic resource handlers (form create/update/delete and Excel import)
 * call holdResourceWrite() after all their checks; with an active scheme the
 * write is held and runs later through executors.ts → the same handler core.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;
export type ResourceOp = "create" | "update" | "delete" | "import";

/** Resource → document for every operation. */
const ALL_OPS: Record<string, string> = {
  "hr-shifts": "hr-shift-change",
  "hr-holidays": "hr-holiday-change",
  "hr-holiday-calendars": "hr-holiday-change",
  "hr-salary-structures": "hr-payroll-setup",
  "hr-pt-slabs": "hr-payroll-setup",
  "hr-pay-components": "hr-payroll-setup",
  "hr-incentive-matrices": "hr-payroll-setup",
  "hr-appraisals": "hr-appraisal",
};
/** Resource → document for adding records only (form or import). */
const CREATE_ONLY: Record<string, string> = {
  "hr-employees": "hr-employee-create",
  "hr-job-openings": "hr-job-opening",
};

const SALARY_FIELDS = ["basic", "hra", "conveyance", "specialAllowance", "otherAllowance", "salaryAmount", "salaryStructureId", "professionalTax", "monthlyTds"];
const MONEY_FIELDS = new Set(["basic", "hra", "conveyance", "specialAllowance", "otherAllowance", "salaryAmount", "professionalTax", "monthlyTds"]);

/** Comparable text of a value as typed or as stored (ids, Decimal128, dates). */
function norm(field: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return MONEY_FIELDS.has(field) ? "0.00" : "";
  if (MONEY_FIELDS.has(field)) {
    try {
      return new Decimal(String(v)).toFixed(2);
    } catch {
      return String(v);
    }
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v && "toHexString" in (v as object)) return String(v);
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? s.slice(0, 10) : s;
}

/** Fields the update actually changes. */
export function changedFields(input: Record<string, unknown>, before: AnyDoc): string[] {
  return Object.keys(input).filter((f) => !["updatedBy", "createdBy"].includes(f) && norm(f, input[f]) !== norm(f, before?.[f]));
}

/**
 * The employee documents an edit falls under, most specific first; it is held
 * under the first one with an active scheme. Any edit is at least an
 * "information modification".
 */
export function employeeEditDocuments(changed: string[], input: Record<string, unknown>): string[] {
  const has = (f: string) => changed.includes(f);
  const out: string[] = [];
  if (has("employmentStatus")) {
    if (input.employmentStatus === "TERMINATED") out.push("hr-termination");
    if (input.employmentStatus === "RESIGNED" || input.employmentStatus === "RETIRED") out.push("hr-resignation");
  }
  if (SALARY_FIELDS.some(has)) out.push("hr-salary-revision");
  if (has("branchId") || has("workLocation")) out.push("hr-transfer");
  if (has("departmentId")) out.push("hr-department-change");
  if (has("designationId")) out.push("hr-designation-change");
  out.push("hr-employee-update");
  return out;
}

async function firstActive(businessId: Types.ObjectId, docs: string[]): Promise<string | null> {
  for (const doc of docs) if (await approvalActive(businessId, doc)) return doc;
  return null;
}

/** The document a write falls under, when its scheme is active; null = no approval applies. */
export async function resourceApprovalDocument(ctx: AuthContext, def: ResourceDefinition, op: ResourceOp, input?: Record<string, unknown>, before?: AnyDoc): Promise<string | null> {
  if (!ctx.products.includes("HRMS")) return null;
  if (def.key === "hr-employees" && op === "update" && input) {
    const changed = changedFields(input, before);
    if (!changed.length) return null;
    return firstActive(ctx.businessId, employeeEditDocuments(changed, input));
  }
  if (def.key === "hr-employees" && op === "delete") return firstActive(ctx.businessId, ["hr-employee-update"]);
  const doc = ALL_OPS[def.key] ?? ((op === "create" || op === "import") ? CREATE_ONLY[def.key] : undefined);
  return doc ? firstActive(ctx.businessId, [doc]) : null;
}

const LABELS: Record<string, string> = {
  departmentId: "Department",
  designationId: "Designation",
  reportingManagerId: "Reporting manager",
  branchId: "Branch",
  gradeId: "Grade",
  shiftId: "Shift",
  workLocation: "Work location",
  employmentType: "Employment type",
  employmentStatus: "Employment status",
  dateOfJoining: "Date of joining",
  exitDate: "Exit date",
  salaryStructureId: "Salary structure",
  salaryAmount: "Salary amount",
  specialAllowance: "Special allowance",
  otherAllowance: "Other allowance",
  hra: "HRA",
  professionalTax: "Professional tax",
  monthlyTds: "Monthly TDS",
};

/** "specialAllowance" → "Special allowance". */
export function fieldLabel(field: string): string {
  if (LABELS[field]) return LABELS[field];
  const s = field.replace(/Id$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const REF_MODELS: Record<string, { model: AnyDoc; field: string }> = {
  departmentId: { model: HrDepartment, field: "name" },
  designationId: { model: Designation, field: "name" },
  reportingManagerId: { model: Employee, field: "name" },
  branchId: { model: Branch, field: "name" },
  gradeId: { model: HrGrade, field: "name" },
  shiftId: { model: Shift, field: "name" },
  headEmployeeId: { model: Employee, field: "name" },
};

export async function showValue(businessId: Types.ObjectId, field: string, v: unknown): Promise<string> {
  if (v === null || v === undefined || v === "") return "—";
  const ref = REF_MODELS[field];
  if (ref && Types.ObjectId.isValid(String(v))) {
    const row = await ref.model.findOne({ _id: String(v), businessId }, { [ref.field]: 1 }).lean();
    return row?.[ref.field] ?? "(removed)";
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? `${v.length} item(s)` : "—";
  if (typeof v === "object" && !(v instanceof Date) && !("toHexString" in (v as object))) return "(changed)";
  const s = norm(field, v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function title(def: ResourceDefinition, rec: AnyDoc): string {
  const name = rec?.name ?? rec?.title ?? rec?.jobTitle ?? rec?.label ?? "";
  const code = rec?.employeeCode ?? rec?.code ?? "";
  return [code, name].filter(Boolean).join(" ") || def.label.toLowerCase();
}

/** Holds a master write for approval, or returns null when none applies. */
export async function holdResourceWrite(
  ctx: AuthContext,
  def: ResourceDefinition,
  w: { op: ResourceOp; id?: string; body?: unknown; input?: Record<string, unknown>; before?: AnyDoc; sheet?: unknown; skipDuplicates?: boolean; rows?: number }
): Promise<HeldResult | null> {
  const document = await resourceApprovalDocument(ctx, def, w.op, w.input, w.before);
  if (!document) return null;
  const what = def.label.toLowerCase();
  const details: { label: string; value: string }[] = [{ label: "Record type", value: def.label }];
  let summary = "";
  let targetKey = `${def.key}:${w.id ?? new Types.ObjectId().toHexString()}`;

  if (w.op === "create") {
    summary = `Add ${what} ${title(def, w.input)}`.trim();
    for (const [f, v] of Object.entries(w.input ?? {}).slice(0, 40)) {
      if (v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length)) continue;
      if (details.length >= 16) break;
      details.push({ label: fieldLabel(f), value: await showValue(ctx.businessId, f, v) });
    }
  } else if (w.op === "update") {
    const changed = changedFields(w.input ?? {}, w.before);
    summary = `Change ${what} ${title(def, w.before)}: ${changed.map(fieldLabel).join(", ")}`;
    for (const f of changed.slice(0, 20)) {
      details.push({ label: fieldLabel(f), value: `${await showValue(ctx.businessId, f, w.before?.[f])} → ${await showValue(ctx.businessId, f, w.input?.[f])}` });
    }
  } else if (w.op === "delete") {
    summary = `Delete ${what} ${title(def, w.before)}`;
  } else {
    summary = `Import ${w.rows ?? 0} ${what} row(s) from Excel`;
    details.push({ label: "Rows", value: String(w.rows ?? 0) }, { label: "Duplicates", value: w.skipDuplicates ? "Skipped" : "Refused" });
    targetKey = `${def.key}:import:${new Types.ObjectId().toHexString()}`;
  }
  if (approvalDocument(document)?.module === "Employees" && w.op === "update") details.unshift({ label: "Employee", value: title(def, w.before) });

  return holdForApproval(ctx, {
    document,
    targetKey,
    recordId: w.id ?? null,
    number: def.key === "hr-employees" ? (w.before?.employeeCode ?? "") : (w.before?.code ?? ""),
    summary,
    details,
    // An employee edit is decided by that employee's manager / department head.
    employeeId: def.key === "hr-employees" && w.id ? w.id : null,
    payload: {
      resource: def.key,
      op: w.op,
      id: w.id ?? null,
      body: w.body ?? null,
      sheet: w.sheet ?? null,
      skipDuplicates: Boolean(w.skipDuplicates),
      baseUpdatedAt: w.before?.updatedAt ? new Date(w.before.updatedAt).toISOString() : null,
    },
  });
}

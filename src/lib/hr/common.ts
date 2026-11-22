import { Types, type ClientSession } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { MasterCounter } from "@/models/MasterCounter";
import { Business } from "@/models/Business";
import { Employee, HrDepartment, Designation } from "@/models/hr";
import type { AuthContext } from "@/lib/auth/context";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyDoc = any;

/** Next number in a per-business HR series, e.g. "LV-000042". Joins the caller's transaction when given one. */
export async function nextHrNumber(businessId: Types.ObjectId, entityType: string, prefix: string, session?: ClientSession): Promise<string> {
  const counter = await MasterCounter.findOneAndUpdate(
    { businessId, entityType },
    { $inc: { lastNumber: 1 } },
    { new: true, upsert: true, ...(session ? { session } : {}) }
  );
  return `${prefix}-${String(counter.lastNumber).padStart(6, "0")}`;
}

export const objectId = z.string().trim().refine((v) => Types.ObjectId.isValid(v), "Choose a valid record");

export async function findEmployee(businessId: Types.ObjectId, id: string | Types.ObjectId): Promise<AnyDoc> {
  if (!Types.ObjectId.isValid(String(id))) throw AppError.notFound("Employee not found");
  const emp = await Employee.findOne({ _id: id, businessId, deletedAt: null }).lean<AnyDoc>();
  if (!emp) throw AppError.notFound("Employee not found");
  return emp;
}

/** The employee record linked to the signed-in user's login (self-service). */
export async function selfEmployee(ctx: AuthContext): Promise<AnyDoc> {
  const emp = await Employee.findOne({ businessId: ctx.businessId, userId: ctx.userId, deletedAt: null }).lean<AnyDoc>();
  if (!emp) {
    throw AppError.notFound("Your login is not linked to an employee profile yet. Ask HR to give you portal access.", "NO_EMPLOYEE_PROFILE");
  }
  return emp;
}

export interface EmployeeLabel {
  id: string;
  code: string;
  name: string;
  department: string;
  designation: string;
}

/** id → code, name, department and designation for display, in one round trip per collection. */
export async function employeeLabels(businessId: Types.ObjectId, ids: (Types.ObjectId | string)[]): Promise<Map<string, EmployeeLabel>> {
  const unique = [...new Set(ids.map(String))].filter((v) => Types.ObjectId.isValid(v));
  if (unique.length === 0) return new Map();
  const emps = await Employee.find({ businessId, _id: { $in: unique } }, { employeeCode: 1, name: 1, departmentId: 1, designationId: 1 }).lean<AnyDoc[]>();
  const [depts, desigs] = await Promise.all([
    HrDepartment.find({ businessId, _id: { $in: emps.map((e) => e.departmentId).filter(Boolean) } }, { name: 1 }).lean<AnyDoc[]>(),
    Designation.find({ businessId, _id: { $in: emps.map((e) => e.designationId).filter(Boolean) } }, { name: 1 }).lean<AnyDoc[]>(),
  ]);
  const dn = new Map(depts.map((d) => [String(d._id), d.name as string]));
  const gn = new Map(desigs.map((d) => [String(d._id), d.name as string]));
  return new Map(
    emps.map((e) => [
      String(e._id),
      {
        id: String(e._id),
        code: e.employeeCode,
        name: e.name,
        department: e.departmentId ? dn.get(String(e.departmentId)) ?? "" : "",
        designation: e.designationId ? gn.get(String(e.designationId)) ?? "" : "",
      },
    ])
  );
}

export async function businessTimeZone(businessId: Types.ObjectId): Promise<string> {
  const b = await Business.findById(businessId, { timeZone: 1 }).lean<{ timeZone?: string }>();
  return b?.timeZone || "Asia/Kolkata";
}

export const monthQuery = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

/** ?page=&pageSize= with the app's usual bounds. */
export const pageQuery = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(15),
};

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

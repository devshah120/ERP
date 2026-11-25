import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { recordAudit } from "@/lib/services/auditService";
import { Employee, Shift, WORKING_STATUSES } from "@/models/hr";
import { Contractor } from "@/models/contractLabour";
import type { AuthContext } from "@/lib/auth/context";
import { employeeLabels, escapeRegex, objectId, pageQuery, type AnyDoc } from "./common";

/*
 * Assign Shift: puts employees, or labour contractors, on a shift in bulk.
 * An employee's shift sets their attendance (late marks, half days, weekly
 * offs); a contractor's shift is followed by its workers who have none of
 * their own and sets their overtime.
 */

export const SHIFT_TARGETS = ["employees", "contractors"] as const;
export type ShiftTarget = (typeof SHIFT_TARGETS)[number];

export const shiftAssignmentListSchema = z.object({
  query: z.string().trim().max(100).optional(),
  departmentId: z.string().trim().regex(/^([a-f\d]{24})?$/i).optional(),
  /** A shift id, "none" (no shift of their own: the default) or blank (everyone). */
  shift: z.string().trim().regex(/^([a-f\d]{24}|none)?$/i).optional(),
  ...pageQuery,
});

export const shiftAssignSchema = z.object({
  ids: z.array(objectId).min(1, "Choose at least one").max(1000),
  /** null = no shift of their own (the default shift applies). */
  shiftId: objectId.nullable(),
});

function baseFilter(ctx: AuthContext, target: ShiftTarget): Record<string, unknown> {
  return target === "employees"
    ? { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: [...WORKING_STATUSES] } }
    : { businessId: ctx.businessId, deletedAt: null, contractStatus: { $ne: "ENDED" } };
}

/** The people of one kind with the shift each follows, and the shifts to choose from with their headcount. */
export async function shiftAssignments(ctx: AuthContext, target: ShiftTarget, params: z.infer<typeof shiftAssignmentListSchema>) {
  const model = target === "employees" ? Employee : Contractor;
  const codeField = target === "employees" ? "employeeCode" : "contractorCode";
  const base = baseFilter(ctx, target);
  const filter: Record<string, unknown> = { ...base };
  if (params.departmentId) filter.departmentId = new Types.ObjectId(params.departmentId);
  if (params.shift === "none") filter.shiftId = null;
  else if (params.shift) filter.shiftId = new Types.ObjectId(params.shift);
  if (params.query) {
    const rx = { $regex: escapeRegex(params.query), $options: "i" };
    filter.$or = [{ name: rx }, { [codeField]: rx }, { workLocation: rx }, ...(target === "contractors" ? [{ firmName: rx }] : [])];
  }

  const [rows, total, shifts, counts] = await Promise.all([
    model
      .find(filter, { [codeField]: 1, name: 1, firmName: 1, workLocation: 1, shiftId: 1 })
      .sort({ name: 1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
      .lean<AnyDoc[]>(),
    model.countDocuments(filter),
    Shift.find({ businessId: ctx.businessId, deletedAt: null }).sort({ name: 1 }).lean<AnyDoc[]>(),
    model.aggregate([{ $match: base }, { $group: { _id: "$shiftId", n: { $sum: 1 } } }]),
  ]);
  const labels = target === "employees" ? await employeeLabels(ctx.businessId, rows.map((r) => r._id)) : new Map();
  const headcount = new Map((counts as AnyDoc[]).map((c) => [c._id ? String(c._id) : "none", c.n as number]));
  const def = shifts.find((s) => s.isDefault && s.status === "ACTIVE");

  return {
    items: rows.map((r) => ({
      id: String(r._id),
      code: r[codeField] as string,
      name: r.name as string,
      detail: target === "employees" ? labels.get(String(r._id))?.department ?? "" : ((r.firmName as string) ?? ""),
      location: (r.workLocation as string) ?? "",
      shiftId: r.shiftId ? String(r.shiftId) : null,
    })),
    total,
    shifts: shifts.map((s) => ({
      id: String(s._id),
      name: s.name as string,
      startTime: s.startTime as string,
      endTime: s.endTime as string,
      isDefault: Boolean(s.isDefault),
      active: s.status === "ACTIVE",
      count: headcount.get(String(s._id)) ?? 0,
    })),
    defaultShift: def ? { id: String(def._id), name: def.name as string, startTime: def.startTime as string, endTime: def.endTime as string } : null,
    withoutShift: headcount.get("none") ?? 0,
  };
}

/** Puts the chosen employees or contractors on a shift (or back on the default with null). */
export async function assignShift(ctx: AuthContext, target: ShiftTarget, input: z.infer<typeof shiftAssignSchema>) {
  const model = target === "employees" ? Employee : Contractor;
  const ids = [...new Set(input.ids)].map((id) => new Types.ObjectId(id));
  let shift: AnyDoc = null;
  if (input.shiftId) {
    shift = await Shift.findOne({ _id: input.shiftId, businessId: ctx.businessId, deletedAt: null }, { name: 1, status: 1 }).lean<AnyDoc>();
    if (!shift) throw AppError.badRequest("That shift was not found; reload the page", "SHIFT_NOT_FOUND");
    if (shift.status !== "ACTIVE") throw AppError.badRequest(`The shift "${shift.name}" is inactive`, "SHIFT_INACTIVE");
  }
  const found = await model.countDocuments({ businessId: ctx.businessId, _id: { $in: ids }, deletedAt: null });
  if (found !== ids.length) throw AppError.badRequest(`Some of these ${target} were not found; reload the page`, "NOT_FOUND");

  const res = await model.updateMany({ businessId: ctx.businessId, _id: { $in: ids }, deletedAt: null }, { shiftId: shift ? shift._id : null, updatedBy: ctx.userId });
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: target === "employees" ? "hr.employees" : "hr.contractors",
    documentType: target === "employees" ? "Employee" : "Contractor",
    newValue: { shift: shift ? shift.name : "Default", [target]: ids.length },
    reason: "Shift assigned",
  });
  return { updated: res.modifiedCount, shift: shift ? (shift.name as string) : null };
}

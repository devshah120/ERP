import { Types } from "mongoose";
import { z } from "zod";
import { AppError } from "@/lib/errors/AppError";
import { Employee, HrGrade, LeaveGroup, WORKING_STATUSES } from "@/models/hr";
import { recordAudit } from "@/lib/services/auditService";
import type { AuthContext } from "@/lib/auth/context";
import { objectId, type AnyDoc } from "./common";

/*
 * "Assign Grade to Group": which leave group each grade follows. An employee's
 * leave entitlement comes from the group of their grade (see balancesFor in
 * leave.ts); a grade with no group keeps each leave type's own quota.
 */

export const gradeAssignmentSchema = z.object({
  assignments: z
    .array(z.object({ gradeId: objectId, leaveGroupId: objectId.nullable() }))
    .min(1, "Nothing to save")
    .max(500),
});

/** Every grade with its leave group and head-count, plus the groups to choose from. */
export async function gradeAssignments(ctx: AuthContext) {
  const [grades, groups, counts] = await Promise.all([
    HrGrade.find({ businessId: ctx.businessId, deletedAt: null }).sort({ code: 1 }).lean<AnyDoc[]>(),
    LeaveGroup.find({ businessId: ctx.businessId, deletedAt: null }).sort({ name: 1 }).lean<AnyDoc[]>(),
    Employee.aggregate([
      { $match: { businessId: ctx.businessId, deletedAt: null, employmentStatus: { $in: [...WORKING_STATUSES] }, gradeId: { $ne: null } } },
      { $group: { _id: "$gradeId", n: { $sum: 1 } } },
    ]),
  ]);
  const employees = new Map((counts as AnyDoc[]).map((c) => [String(c._id), c.n as number]));
  return {
    grades: grades.map((g) => ({
      id: String(g._id),
      code: g.code as string,
      name: g.name as string,
      active: g.status === "ACTIVE",
      leaveGroupId: g.leaveGroupId ? String(g.leaveGroupId) : null,
      employees: employees.get(String(g._id)) ?? 0,
    })),
    groups: groups.map((g) => ({
      id: String(g._id),
      code: g.code as string,
      name: g.name as string,
      active: g.status === "ACTIVE",
      leaveTypes: ((g.leaveTypes ?? []) as AnyDoc[]).length,
    })),
  };
}

/** Saves the leave group of each listed grade (null clears it). Only grades whose group changed are written. */
export async function assignGrades(ctx: AuthContext, input: z.infer<typeof gradeAssignmentSchema>) {
  const gradeIds = [...new Set(input.assignments.map((a) => a.gradeId))];
  if (gradeIds.length !== input.assignments.length) throw AppError.badRequest("A grade is listed twice", "DUPLICATE_GRADE");
  const groupIds = [...new Set(input.assignments.map((a) => a.leaveGroupId).filter((v): v is string => Boolean(v)))];

  const [grades, groups] = await Promise.all([
    HrGrade.find({ businessId: ctx.businessId, _id: { $in: gradeIds }, deletedAt: null }, { code: 1, leaveGroupId: 1 }).lean<AnyDoc[]>(),
    LeaveGroup.find({ businessId: ctx.businessId, _id: { $in: groupIds }, deletedAt: null }, { name: 1, status: 1 }).lean<AnyDoc[]>(),
  ]);
  if (grades.length !== gradeIds.length) throw AppError.badRequest("A grade was not found; reload the page", "GRADE_NOT_FOUND");
  if (groups.length !== groupIds.length) throw AppError.badRequest("A leave group was not found; reload the page", "LEAVE_GROUP_NOT_FOUND");

  const current = new Map(grades.map((g) => [String(g._id), g]));
  const changes = input.assignments.filter((a) => (current.get(a.gradeId)?.leaveGroupId ? String(current.get(a.gradeId)!.leaveGroupId) : null) !== a.leaveGroupId);
  if (changes.length === 0) return { updated: 0 };

  // Choosing an inactive group is refused; a grade already on one may keep it.
  const inactive = new Set(groups.filter((g) => g.status !== "ACTIVE").map((g) => String(g._id)));
  const toInactive = changes.find((c) => c.leaveGroupId && inactive.has(c.leaveGroupId));
  if (toInactive) throw AppError.badRequest(`The leave group "${groups.find((g) => String(g._id) === toInactive.leaveGroupId)?.name}" is inactive`, "LEAVE_GROUP_INACTIVE");

  await HrGrade.bulkWrite(
    changes.map((c) => ({
      updateOne: {
        filter: { _id: new Types.ObjectId(c.gradeId), businessId: ctx.businessId },
        update: { $set: { leaveGroupId: c.leaveGroupId ? new Types.ObjectId(c.leaveGroupId) : null, updatedBy: ctx.userId } },
      },
    }))
  );
  const groupName = new Map(groups.map((g) => [String(g._id), g.name as string]));
  await recordAudit({
    businessId: ctx.businessId,
    userId: ctx.userId,
    action: "UPDATE",
    module: "hr.leave",
    documentType: "HrGrade",
    oldValue: Object.fromEntries(changes.map((c) => [current.get(c.gradeId)!.code, current.get(c.gradeId)!.leaveGroupId ? String(current.get(c.gradeId)!.leaveGroupId) : null])),
    newValue: Object.fromEntries(changes.map((c) => [current.get(c.gradeId)!.code, c.leaveGroupId ? groupName.get(c.leaveGroupId) ?? c.leaveGroupId : null])),
    reason: "Grades assigned to leave groups",
  });
  return { updated: changes.length };
}

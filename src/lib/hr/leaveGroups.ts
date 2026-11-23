import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { GradeLeaveGroup, HrGrade, LeaveGroup } from "@/models/hr";
import type { AuthContext } from "@/lib/auth/context";
import type { AnyDoc } from "./common";

/*
 * "Assign Leave Group to Grade" (master hr-grade-leave-groups): which leave
 * group each grade follows. An employee's leave entitlement comes from the
 * group of their grade (see balancesFor in leave.ts); a grade with no group
 * keeps each leave type's own quota.
 */

/**
 * Moves assignments kept on the grade itself (the earlier screen stored
 * HrGrade.leaveGroupId) into GradeLeaveGroup rows, once. Cheap when there is
 * nothing to move.
 */
export async function migrateLegacyGradeGroups(businessId: Types.ObjectId): Promise<void> {
  const legacy = await HrGrade.find({ businessId, leaveGroupId: { $ne: null } }, { leaveGroupId: 1 }).lean<AnyDoc[]>();
  if (legacy.length === 0) return;
  const existing = new Set(
    (await GradeLeaveGroup.find({ businessId, deletedAt: null, gradeId: { $in: legacy.map((g) => g._id) } }, { gradeId: 1 }).lean<AnyDoc[]>()).map((r) => String(r.gradeId))
  );
  const rows = legacy.filter((g) => !existing.has(String(g._id))).map((g) => ({ businessId, gradeId: g._id, leaveGroupId: g.leaveGroupId }));
  if (rows.length > 0) {
    try {
      await GradeLeaveGroup.insertMany(rows, { ordered: false });
    } catch (err) {
      // Two first visits at once: the unique index keeps one row per grade.
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  }
  await HrGrade.updateMany({ businessId, _id: { $in: legacy.map((g) => g._id) } }, { $set: { leaveGroupId: null } });
}

/**
 * Refuses an assignment to an unknown grade or group, an inactive group, or a
 * grade that already follows a group (`excludeId` is the row being edited).
 */
export async function assertGradeGroupAllowed(ctx: AuthContext, gradeId: unknown, leaveGroupId: unknown, excludeId?: Types.ObjectId) {
  const [grade, group] = await Promise.all([
    gradeId ? HrGrade.findOne({ _id: gradeId, businessId: ctx.businessId, deletedAt: null }, { name: 1 }).lean<AnyDoc>() : null,
    leaveGroupId ? LeaveGroup.findOne({ _id: leaveGroupId, businessId: ctx.businessId, deletedAt: null }, { name: 1, status: 1 }).lean<AnyDoc>() : null,
  ]);
  if (gradeId && !grade) throw AppError.badRequest("Choose a grade from the list", "GRADE_NOT_FOUND");
  if (leaveGroupId && !group) throw AppError.badRequest("Choose a leave group from the list", "LEAVE_GROUP_NOT_FOUND");
  if (group && group.status !== "ACTIVE") throw AppError.badRequest(`The leave group "${group.name}" is inactive`, "LEAVE_GROUP_INACTIVE");
  if (grade) {
    const taken = await GradeLeaveGroup.findOne({ businessId: ctx.businessId, deletedAt: null, gradeId: grade._id, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }, { leaveGroupId: 1 }).lean<AnyDoc>();
    if (taken) {
      const other = await LeaveGroup.findOne({ _id: taken.leaveGroupId, businessId: ctx.businessId }, { name: 1 }).lean<AnyDoc>();
      throw AppError.conflict(`${grade.name} already follows ${other?.name ?? "a leave group"}. Edit that assignment instead.`, "GRADE_ALREADY_ASSIGNED");
    }
  }
}

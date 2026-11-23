import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { gradeAssignments, assignGrades, gradeAssignmentSchema } from "@/lib/hr/leaveGroups";

/** Grades with the leave group each follows, and the groups to choose from. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leave-types.view");
  return ok(await gradeAssignments(ctx));
});

/** Assigns grades to leave groups (leave policy, so it rides on the leave-type permissions). */
export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leave-types.edit");
  const result = await assignGrades(ctx, gradeAssignmentSchema.parse(await req.json()));
  return ok(result, result.updated ? "Leave groups assigned" : "No changes");
});

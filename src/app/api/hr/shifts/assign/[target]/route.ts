import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { shiftAssignments, assignShift, shiftAssignmentListSchema, shiftAssignSchema, SHIFT_TARGETS, type ShiftTarget } from "@/lib/hr/shiftAssign";

/** The master whose records a shift is assigned to: employees or labour contractors. */
function targetOf(value: string): { target: ShiftTarget; module: string } {
  if (!(SHIFT_TARGETS as readonly string[]).includes(value)) throw AppError.notFound("Unknown shift assignment");
  const target = value as ShiftTarget;
  return { target, module: target === "employees" ? "hr-employees" : "hr-contractors" };
}

/** Everyone of that kind with the shift each follows, and the shifts to choose from. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  const { target, module } = targetOf((await params).target);
  requirePermission(ctx, "hr-shifts.view");
  requirePermission(ctx, `${module}.view`);
  return ok(await shiftAssignments(ctx, target, shiftAssignmentListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Puts them on a shift; it changes their records, so it needs both permissions. */
export const PUT = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  const { target, module } = targetOf((await params).target);
  requirePermission(ctx, "hr-shifts.edit");
  requirePermission(ctx, `${module}.edit`);
  return ok(await assignShift(ctx, target, shiftAssignSchema.parse(await req.json())), "Shift assigned");
});

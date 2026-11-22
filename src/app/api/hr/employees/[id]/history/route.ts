import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { employmentHistory, recordChange, changeSchema } from "@/lib/hr/history";

/** The employee's dated job and salary changes, newest first. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employees.view");
  const { id } = await params;
  return ok(await employmentHistory(ctx, id));
});

/** Records a salary revision, promotion, transfer or status change from a date. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employees.edit");
  const { id } = await params;
  const result = await recordChange(ctx, id, changeSchema.parse(await req.json()));
  return created(result, result.scheduled ? `Change scheduled from ${result.effectiveDate}` : "Change recorded");
});

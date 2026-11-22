import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listLeaves, leaveListSchema, applyLeave, applyLeaveSchema } from "@/lib/hr/leave";
import { selfEmployee } from "@/lib/hr/common";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  return ok(await listLeaves(ctx, leaveListSchema.parse(Object.fromEntries(req.nextUrl.searchParams)), { employeeId: emp._id }));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const input = applyLeaveSchema.parse(await req.json());
  return created(await applyLeave(ctx, input, { self: true }), "Leave request sent for approval");
});

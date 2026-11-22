import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listLeaves, leaveListSchema, applyLeave, applyLeaveSchema } from "@/lib/hr/leave";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leaves.view");
  return ok(await listLeaves(ctx, leaveListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Files a leave request: one's own, or (Owner only) on an employee's behalf. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-leaves.create");
  const input = applyLeaveSchema.parse(await req.json());
  return created(await applyLeave(ctx, input, { self: false }), "Leave request filed");
});

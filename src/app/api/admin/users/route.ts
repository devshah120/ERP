import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listUsers } from "@/lib/services/adminService";
import { createUser, userCreateSchema } from "@/lib/services/adminWriteService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "users.view");
  return ok(await listUsers(ctx.businessId));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "users.create");
  const input = userCreateSchema.parse(await req.json());
  return created(await createUser(input, ctx), "Employee added");
});

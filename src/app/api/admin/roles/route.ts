import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listRoles } from "@/lib/services/adminService";
import { createRole, roleCreateSchema } from "@/lib/services/adminWriteService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "roles.view");
  return ok(await listRoles(ctx.businessId));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "roles.manage");
  const input = roleCreateSchema.parse(await req.json());
  return created(await createRole(input, ctx), "Role created");
});

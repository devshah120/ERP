import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { updateRole, deleteRole, roleUpdateSchema } from "@/lib/services/adminWriteService";
import "@/models";

export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "roles.manage");
  const input = roleUpdateSchema.parse(await req.json());
  return ok(await updateRole(id, input, ctx), "Role saved");
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "roles.manage");
  await deleteRole(id, ctx);
  return ok(null, "Role deleted");
});

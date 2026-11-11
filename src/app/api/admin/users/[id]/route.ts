import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { updateUser, userUpdateSchema } from "@/lib/services/adminWriteService";
import "@/models";

/** Disabling or re-enabling someone is its own permission, separate from editing their details. */
export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  const input = userUpdateSchema.parse(await req.json());
  if (input.status) requirePermission(ctx, "users.disable");
  if (input.name || input.phone || input.roleId) requirePermission(ctx, "users.edit");
  return ok(await updateUser(id, input, ctx), "Employee updated");
});

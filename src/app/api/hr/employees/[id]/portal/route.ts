import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission, requireAnyPermission } from "@/lib/auth/context";
import "@/models";
import { grantPortalAccess, revokePortalAccess, portalAccessSchema } from "@/lib/hr/people";

/** Gives the employee a self-service login (or links an existing one). */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requireAnyPermission(ctx, ["hr-employee-directory.edit", "hr-employees.edit"]);
  requirePermission(ctx, "users.create");
  const { id } = await params;
  const result = await grantPortalAccess(ctx, id, portalAccessSchema.parse(await req.json()));
  return created(result, result.created ? "Portal login created" : "Existing login linked");
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requireAnyPermission(ctx, ["hr-employee-directory.edit", "hr-employees.edit"]);
  requirePermission(ctx, "users.disable");
  const { id } = await params;
  return ok(await revokePortalAccess(ctx, id), "Portal access removed");
});

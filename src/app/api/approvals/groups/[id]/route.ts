import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { updateGroup, deleteGroup, groupInputSchema } from "@/lib/approvals/service";
import "@/models";

export const PUT = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.manage");
  return ok(await updateGroup(ctx, id, groupInputSchema.parse(await req.json())), "User group saved");
});

export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.manage");
  await deleteGroup(ctx, id);
  return ok(null, "User group deleted");
});

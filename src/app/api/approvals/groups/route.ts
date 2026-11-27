import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listGroups, createGroup, groupInputSchema } from "@/lib/approvals/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.view");
  return ok(await listGroups(ctx));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.manage");
  return created(await createGroup(ctx, groupInputSchema.parse(await req.json())), "User group created");
});

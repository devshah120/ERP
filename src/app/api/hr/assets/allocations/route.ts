import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listAllocations, allocationListSchema, allocateAsset, allocateSchema } from "@/lib/hr/assets";

/** ?status=ALLOCATED|RETURNED&query=&employeeId=: asset allocations with the asset and employee. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-assets.view");
  return ok(await listAllocations(ctx, allocationListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Gives an available asset to an employee. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-assets.edit");
  const result = await allocateAsset(ctx, allocateSchema.parse(await req.json()));
  return okOrHeld(result, (r) => `Asset allocated (${r.allocationNumber})`, 201);
});

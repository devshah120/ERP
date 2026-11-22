import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listClaims, claimListSchema, createClaim, claimCreateSchema } from "@/lib/hr/money";
import { selfEmployee } from "@/lib/hr/common";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const emp = await selfEmployee(ctx);
  return ok(await listClaims(ctx, claimListSchema.parse(Object.fromEntries(req.nextUrl.searchParams)), { employeeId: emp._id }));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const result = await createClaim(ctx, claimCreateSchema.parse(await req.json()), { self: true });
  return created(result, `Claim ${result.claimNumber} submitted`);
});

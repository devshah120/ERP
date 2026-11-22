import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listClaims, claimListSchema, createClaim, claimCreateSchema } from "@/lib/hr/money";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.view");
  return ok(await listClaims(ctx, claimListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-claims.create");
  const result = await createClaim(ctx, claimCreateSchema.parse(await req.json()), { self: false });
  return created(result, `Claim ${result.claimNumber} recorded`);
});

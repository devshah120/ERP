import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listFnf, createFnf, createFnfSchema } from "@/lib/hr/fnf";

/** Full & final settlements, optionally by ?status=. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  return ok(await listFnf(ctx, req.nextUrl.searchParams.get("status") ?? undefined));
});

/** Starts a settlement for a leaving employee as a calculated draft. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  return created(await createFnf(ctx, createFnfSchema.parse(await req.json())), "Settlement drafted");
});

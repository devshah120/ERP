import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { ok, created } from "@/lib/http/response";
import { listMyCorrections, requestCorrection, correctionListSchema, correctionSchema } from "@/lib/hr/corrections";

/** The signed-in employee's attendance correction requests. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  return ok(await listMyCorrections(ctx, correctionListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Ask for one day's attendance to be corrected; it goes to the reporting manager or HR. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  return created(await requestCorrection(ctx, correctionSchema.parse(await req.json())), "Correction request sent for approval");
});

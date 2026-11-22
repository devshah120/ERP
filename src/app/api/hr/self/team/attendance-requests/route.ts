import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { ok } from "@/lib/http/response";
import { listTeamCorrections, correctionListSchema } from "@/lib/hr/corrections";

/** Attendance correction requests from the signed-in employee's direct reports. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  return ok(await listTeamCorrections(ctx, correctionListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

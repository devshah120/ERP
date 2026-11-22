import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { ok } from "@/lib/http/response";
import { listAllCorrections, correctionListSchema } from "@/lib/hr/corrections";

/** Every attendance correction request in the workspace. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.view");
  return ok(await listAllCorrections(ctx, correctionListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { directory, directorySchema } from "@/lib/hr/people";

/** Employee directory (current, former or all) with department and manager names. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-employee-directory.view");
  return ok(await directory(ctx, directorySchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { punch } from "@/lib/hr/attendance";

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const result = await punch(ctx);
  return ok(result, result.action === "CHECK_IN" ? `Checked in at ${result.time}` : `Checked out at ${result.time}`);
});

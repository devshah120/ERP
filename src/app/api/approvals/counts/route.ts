import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { approvalCounts } from "@/lib/approvals/service";
import "@/models";

/** Badge counts: approvals waiting for me, my requests sent back to me, my requests still waiting. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  return ok(await approvalCounts(ctx));
});

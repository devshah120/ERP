import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import "@/models";
import { requestHistory } from "@/lib/approvals/service";

/**
 * Every approval round of a record, with each stage's decision. Private:
 * only approvals viewers, the requester and the people named on its stages
 * may see it (checked in requestHistory).
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  return ok(await requestHistory(ctx, id));
});

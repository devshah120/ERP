import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { requestDetail } from "@/lib/approvals/service";
import "@/models";

/**
 * One approval request in full: what is being approved, its stages,
 * comments, earlier rounds and what the signed-in user may do with it.
 * Private to approvals viewers, the requester and its approvers.
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  return ok(await requestDetail(ctx, id));
});

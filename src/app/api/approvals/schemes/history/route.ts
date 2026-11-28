import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { schemeHistory } from "@/lib/approvals/service";

/** Who changed which approval scheme when, with the stages before and after (?document= for one document). */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.view");
  return ok(await schemeHistory(ctx, req.nextUrl.searchParams.get("document") ?? undefined));
});

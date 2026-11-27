import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getScheme, saveScheme, schemeInputSchema } from "@/lib/approvals/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { document } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.view");
  return ok(await getScheme(ctx, document));
});

export const PUT = withApiHandler(async (req: NextRequest, { params }) => {
  const { document } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "approvals.manage");
  return ok(await saveScheme(ctx, document, schemeInputSchema.parse(await req.json())), "Approval scheme saved");
});

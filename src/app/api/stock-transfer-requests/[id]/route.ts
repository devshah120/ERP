import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getTransferRequest, actOnTransferRequest } from "@/lib/inventory/operationsService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "stock-transfer-requests.view");
  return ok(await getTransferRequest(id, ctx));
});

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "cancel", "fulfil"]).default("cancel"),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Approving and rejecting need .approve; fulfilling also needs permission to
 * raise a stock transfer, because that is what it does.
 */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  const { action, reason } = actionSchema.parse(await req.json());
  if (action === "cancel") requirePermission(ctx, "stock-transfer-requests.cancel");
  else requirePermission(ctx, "stock-transfer-requests.approve");
  if (action === "fulfil") requirePermission(ctx, "stock-transfers.create");
  await actOnTransferRequest(id, action, reason, ctx);
  return ok(await getTransferRequest(id, ctx));
});

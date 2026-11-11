import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { listTransferRequests, createTransferRequest, transferRequestSchema } from "@/lib/inventory/operationsService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "stock-transfer-requests.view");
  return ok(await listTransferRequests(req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "stock-transfer-requests.create");
  const input = transferRequestSchema.parse(await req.json());
  return created(await createTransferRequest(input, ctx), "Request raised");
});

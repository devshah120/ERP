import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getCreditNote, cancelCreditNote } from "@/lib/pos/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.view");
  return ok(await getCreditNote(id, ctx));
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.cancel");
  const { reason } = z.object({ reason: z.string().trim().min(1, "A reason is required").max(500) }).parse(await req.json());
  return ok(await cancelCreditNote(id, reason, ctx), "Credit note cancelled");
});
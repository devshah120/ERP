import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { quoteCart, quoteSchema } from "@/lib/pos/service";
import "@/models";

/** Prices a cart exactly as the sale will be billed, without saving anything. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.sell");
  return ok(await quoteCart(ctx.businessId, quoteSchema.parse(await req.json())));
});
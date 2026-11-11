import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { currentRegister } from "@/lib/pos/service";
import "@/models";

/** The signed-in cashier's open register, or null. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.sell");
  return ok(await currentRegister(ctx));
});
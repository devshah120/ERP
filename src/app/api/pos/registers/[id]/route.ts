import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getRegister, closeRegister, closeRegisterSchema } from "@/lib/pos/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.view");
  return ok(await getRegister(id, ctx));
});

/** Close the shift with the counted cash. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { id } = await params;
  const ctx = getAuthContext(req);
  requirePermission(ctx, "pos.sell");
  return ok(await closeRegister(id, closeRegisterSchema.parse(await req.json()), ctx), "Register closed");
});
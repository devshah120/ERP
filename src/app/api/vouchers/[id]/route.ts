import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getVoucher, cancelVoucher } from "@/lib/accounting/voucherService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "vouchers.view");
  const { id } = await params;
  return ok(await getVoucher(id, ctx));
});

/** Cancels by posting the mirror entry — the original is never deleted. */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "vouchers.cancel");

  const { id } = await params;
  const reason = req.nextUrl.searchParams.get("reason") ?? undefined;
  return ok(await cancelVoucher(id, reason, ctx), "Voucher cancelled and reversed");
});

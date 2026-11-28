import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { createVoucher, listVouchers, voucherCreateSchema } from "@/lib/accounting/voucherService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "vouchers.view");
  return ok(await listVouchers(req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "vouchers.create");

  const input = voucherCreateSchema.parse(await req.json());
  return okOrHeld(await createVoucher(input, ctx), "Voucher posted successfully", 201);
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getPaymentType } from "@/lib/payments/types";
import { getPayment, cancelPayment, paymentCancelSchema } from "@/lib/payments/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { payType, id } = await params;
  const type = getPaymentType(payType);
  if (!type) throw AppError.notFound("Unknown payment type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, type.permissions.view);

  return ok(await getPayment(type, id, ctx));
});

/**
 * Cancellation rather than deletion: the entry stays on file and the money
 * it settled is returned to the invoices it was allocated against.
 */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { payType, id } = await params;
  const type = getPaymentType(payType);
  if (!type) throw AppError.notFound("Unknown payment type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, type.permissions.cancel);

  const reason = req.nextUrl.searchParams.get("reason") ?? undefined;
  paymentCancelSchema.parse({ reason });

  return ok(await cancelPayment(type, id, reason, ctx), `${type.label} cancelled`);
});

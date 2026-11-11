import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getPaymentType, paymentCreateSchema } from "@/lib/payments/types";
import { createPayment, listPayments } from "@/lib/payments/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { payType } = await params;
  const type = getPaymentType(payType);
  if (!type) throw AppError.notFound("Unknown payment type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, type.permissions.view);

  return ok(await listPayments(type, req.nextUrl.searchParams, ctx));
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { payType } = await params;
  const type = getPaymentType(payType);
  if (!type) throw AppError.notFound("Unknown payment type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, type.permissions.create);

  const input = paymentCreateSchema.parse(await req.json());
  const doc = await createPayment(type, input, ctx);

  return created(doc, `${type.label} recorded successfully`);
});

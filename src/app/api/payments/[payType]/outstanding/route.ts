import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getPaymentType } from "@/lib/payments/types";
import { listOutstandingInvoices } from "@/lib/payments/service";
import "@/models";

/** Open invoices for one party — drives the allocation picker on the form. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { payType } = await params;
  const type = getPaymentType(payType);
  if (!type) throw AppError.notFound("Unknown payment type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, type.permissions.view);

  const partyId = req.nextUrl.searchParams.get("partyId");
  if (!partyId) throw AppError.badRequest(`${type.partyLabel} is required`, "PARTY_REQUIRED");

  return ok({ items: await listOutstandingInvoices(type, partyId, ctx) });
});

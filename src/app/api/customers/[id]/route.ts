import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { updateCustomerSchema } from "@/lib/validation/customerSchemas";
import { getCustomer, updateCustomer, deleteCustomer } from "@/lib/services/customerService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, PERMISSIONS.CUSTOMER_VIEW);

  const { id } = await params;
  const customer = await getCustomer(ctx.businessId.toString(), id);

  return ok(customer);
});

export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, PERMISSIONS.CUSTOMER_EDIT);

  const { id } = await params;
  const body = await req.json();
  const input = updateCustomerSchema.parse(body);
  const customer = await updateCustomer(ctx.businessId.toString(), id, input, ctx.userId.toString());

  return ok(customer, "Customer updated successfully");
});

/**
 * Soft delete — the record is retained because historical documents still
 * point at it. See deleteCustomer.
 */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, PERMISSIONS.CUSTOMER_DELETE);

  const { id } = await params;
  await deleteCustomer(ctx.businessId.toString(), id, ctx.userId.toString());

  return ok(null, "Customer deleted successfully");
});

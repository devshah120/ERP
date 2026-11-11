import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createCustomerSchema, listCustomersQuerySchema } from "@/lib/validation/customerSchemas";
import { listCustomers, createCustomer } from "@/lib/services/customerService";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, PERMISSIONS.CUSTOMER_VIEW);

  const query = listCustomersQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
  const result = await listCustomers(ctx.businessId.toString(), query);

  return ok(result);
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, PERMISSIONS.CUSTOMER_CREATE);

  const body = await req.json();
  const input = createCustomerSchema.parse(body);
  const customer = await createCustomer(ctx.businessId.toString(), input, ctx.userId.toString());

  return created(customer, "Customer created successfully");
});

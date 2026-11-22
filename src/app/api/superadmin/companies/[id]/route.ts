import { NextRequest } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { AppError } from "@/lib/errors/AppError";
import { recordAudit } from "@/lib/services/auditService";
import { seedHrDefaults } from "@/lib/hr/setup";
import { normalizeProducts, PRODUCTS } from "@/lib/products";
import { Business } from "@/models/Business";
import { Employee, WORKING_STATUSES } from "@/models/hr";
import "@/models";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

function view(b: AnyDoc, employeeCount: number) {
  return {
    id: b._id.toString(),
    legalName: b.legalName,
    tradeName: b.tradeName,
    domain: b.domain,
    email: b.email,
    phone: b.phone,
    status: b.status,
    country: b.country,
    state: b.state,
    city: b.city,
    address: b.address,
    gstin: b.gstin ?? null,
    registrationNumber: b.registrationNumber ?? null,
    currency: b.currency,
    financialYearStartMonth: b.financialYearStartMonth,
    products: normalizeProducts(b.products),
    plan: b.plan ?? null,
    maxEmployees: b.maxEmployees ?? null,
    subscriptionEndsAt: b.subscriptionEndsAt ?? null,
    provisionedBy: b.provisionedBy ?? "SELF",
    employeeCount,
    createdAt: b.createdAt,
  };
}

async function activeEmployees(businessId: Types.ObjectId) {
  return Employee.countDocuments({ businessId, deletedAt: null, employmentStatus: { $in: WORKING_STATUSES } });
}

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  getSAContext(req);
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Company not found");

  const b = await Business.findById(id).lean<AnyDoc>();
  if (!b) throw AppError.notFound("Company not found");
  return ok(view(b, await activeEmployees(b._id)));
});

const patchSchema = z
  .object({
    status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
    products: z.array(z.enum(PRODUCTS)).min(1, "Keep at least one product").optional(),
    plan: z.string().trim().min(1).max(40).optional(),
    /** null removes the limit. */
    maxEmployees: z.coerce.number().int().min(1).max(100000).nullable().optional(),
    /** "yyyy-mm-dd", or null / "" for no expiry. */
    subscriptionEndsAt: z.string().trim().nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

/**
 * Status (suspend / activate) and the subscription: products, plan, employee
 * limit and expiry. Turning HRMS on seeds the HR starter setup; changes reach
 * signed-in users at their next token refresh (within 15 minutes).
 */
export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  getSAContext(req);
  const { id } = await params;
  if (!Types.ObjectId.isValid(id)) throw AppError.notFound("Company not found");

  const input = patchSchema.parse(await req.json());
  const before = await Business.findById(id).lean<AnyDoc>();
  if (!before) throw AppError.notFound("Company not found");

  const update: Record<string, unknown> = {};
  if (input.status) update.status = input.status;
  if (input.products) update.products = [...new Set(input.products)];
  if (input.plan) update.plan = input.plan;
  if (input.maxEmployees !== undefined) update.maxEmployees = input.maxEmployees;
  if (input.subscriptionEndsAt !== undefined) {
    update.subscriptionEndsAt = input.subscriptionEndsAt ? new Date(`${input.subscriptionEndsAt.slice(0, 10)}T23:59:59.999Z`) : null;
  }

  const b = await Business.findByIdAndUpdate(id, update, { new: true }).lean<AnyDoc>();
  if (!b) throw AppError.notFound("Company not found");

  const hadHr = normalizeProducts(before.products).includes("HRMS");
  if (!hadHr && normalizeProducts(b.products).includes("HRMS")) await seedHrDefaults(b._id);

  await recordAudit({
    businessId: b._id,
    userId: null,
    action: "UPDATE",
    module: "superadmin",
    documentType: "Business",
    documentId: b._id,
    oldValue: { status: before.status, products: before.products, plan: before.plan, maxEmployees: before.maxEmployees, subscriptionEndsAt: before.subscriptionEndsAt },
    newValue: update,
    reason: "Changed by the product owner",
  });

  return ok(view(b, await activeEmployees(b._id)));
});

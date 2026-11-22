import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getSAContext } from "@/lib/auth/superAdminContext";
import { isPasswordStrongEnough } from "@/lib/auth/password";
import { gstinSchema } from "@/lib/validation/gstin";
import { provisionWorkspace } from "@/lib/services/provisioningService";
import { normalizeProducts, PRODUCTS } from "@/lib/products";
import { Business } from "@/models/Business";
import { User } from "@/models/User";
import { Employee, WORKING_STATUSES } from "@/models/hr";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest) => {
  getSAContext(req);

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION" | null = all

  const filter = status ? { status } : {};
  const businesses = await Business.find(filter)
    .sort({ createdAt: -1 })
    .select("legalName tradeName domain email phone status createdAt gstin country products plan maxEmployees subscriptionEndsAt provisionedBy")
    .lean();

  // Attach user and active-employee counts per business
  const ids = businesses.map((b) => b._id);
  const [counts, employeeCounts] = await Promise.all([
    User.aggregate([{ $match: { businessId: { $in: ids } } }, { $group: { _id: "$businessId", count: { $sum: 1 } } }]),
    Employee.aggregate([
      { $match: { businessId: { $in: ids }, deletedAt: null, employmentStatus: { $in: [...WORKING_STATUSES] } } },
      { $group: { _id: "$businessId", count: { $sum: 1 } } },
    ]),
  ]);
  const countMap = new Map(counts.map((c) => [c._id.toString(), c.count as number]));
  const employeeMap = new Map(employeeCounts.map((c) => [c._id.toString(), c.count as number]));
  const now = Date.now();

  const items = businesses.map((b) => ({
    id: b._id.toString(),
    legalName: b.legalName,
    tradeName: b.tradeName,
    domain: b.domain,
    email: b.email,
    phone: b.phone,
    status: b.status,
    country: b.country,
    gstin: b.gstin ?? null,
    userCount: countMap.get(b._id.toString()) ?? 0,
    employeeCount: employeeMap.get(b._id.toString()) ?? 0,
    products: normalizeProducts(b.products),
    plan: b.plan ?? null,
    maxEmployees: b.maxEmployees ?? null,
    subscriptionEndsAt: b.subscriptionEndsAt ?? null,
    expired: Boolean(b.subscriptionEndsAt && new Date(b.subscriptionEndsAt).getTime() < now),
    provisionedBy: b.provisionedBy ?? "SELF",
    createdAt: b.createdAt,
  }));

  // Summary counts for dashboard cards
  const summary = {
    total: items.length,
    active: items.filter((i) => i.status === "ACTIVE").length,
    suspended: items.filter((i) => i.status === "SUSPENDED").length,
    pending: items.filter((i) => i.status === "PENDING_VERIFICATION").length,
    erp: items.filter((i) => i.products.includes("ERP")).length,
    hrms: items.filter((i) => i.products.includes("HRMS")).length,
    expired: items.filter((i) => i.expired).length,
    employees: items.reduce((t, i) => t + i.employeeCount, 0),
  };

  return ok({ items, summary });
});

const createSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the company name").max(200),
  tradeName: z.string().trim().max(200).optional().or(z.literal("")),
  ownerName: z.string().trim().min(2, "Enter the owner's name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(20).optional().or(z.literal("")),
  password: z
    .string()
    .min(8, "At least 8 characters")
    .refine(isPasswordStrongEnough, "Include an uppercase letter, lowercase letter, digit and symbol"),
  country: z.string().trim().min(2).max(100).default("India"),
  state: z.string().trim().max(100).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")),
  address: z.string().trim().max(300).optional().or(z.literal("")),
  gstin: gstinSchema,
  currency: z.string().trim().toUpperCase().length(3).default("INR"),
  timeZone: z.string().trim().min(1).default("Asia/Kolkata"),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12).default(4),
  products: z.array(z.enum(PRODUCTS)).min(1, "Choose at least one product"),
  plan: z.string().trim().min(1).max(40).default("STARTER"),
  maxEmployees: z.coerce.number().int().min(1).max(100000).nullable().optional(),
  subscriptionEndsAt: z.string().trim().optional().or(z.literal("")),
});

/** The product owner creates and sells a workspace: active at once, owner login ready to hand over. */
export const POST = withApiHandler(async (req: NextRequest) => {
  getSAContext(req);
  const input = createSchema.parse(await req.json());
  const result = await provisionWorkspace({
    legalName: input.legalName,
    tradeName: input.tradeName || undefined,
    ownerName: input.ownerName,
    email: input.email,
    phone: input.phone || undefined,
    password: input.password,
    country: input.country,
    state: input.state || undefined,
    city: input.city || undefined,
    address: input.address || undefined,
    gstin: input.gstin || undefined,
    currency: input.currency,
    timeZone: input.timeZone,
    financialYearStartMonth: input.financialYearStartMonth,
    products: [...new Set(input.products)],
    plan: input.plan,
    maxEmployees: input.maxEmployees ?? null,
    subscriptionEndsAt: input.subscriptionEndsAt ? new Date(`${input.subscriptionEndsAt.slice(0, 10)}T23:59:59.999Z`) : null,
  });
  return created({ ...result, loginEmail: input.email }, "Workspace created");
});

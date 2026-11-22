import mongoose, { type ClientSession, Types } from "mongoose";
import { Business } from "@/models/Business";
import { Branch } from "@/models/Branch";
import { Warehouse } from "@/models/Warehouse";
import { FinancialYear } from "@/models/FinancialYear";
import { Role, OWNER_ROLE_NAME, OWNER_ALL_PERMISSIONS } from "@/models/Role";
import { User } from "@/models/User";
import { computeCurrentFinancialYear } from "@/lib/services/financialYearService";
import { seedHrDefaults } from "@/lib/hr/setup";
import { hashPassword } from "@/lib/auth/password";
import { usernameFromEmail } from "@/lib/auth/username";
import { resolveGstState } from "@/lib/gst/states";
import { recordAudit } from "@/lib/services/auditService";
import type { Product } from "@/lib/products";

/** "Rangoli Textiles" → "rangoli-textiles", padded so it always meets the 3-character minimum. */
export function slugifyDomain(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length >= 3 ? base : `${base || "workspace"}-ws`;
}

/** First free ID among base, base-2, base-3… then a random suffix as a last resort. */
export async function uniqueDomain(base: string): Promise<string> {
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    if (!(await Business.exists({ domain: candidate }))) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface WorkspaceSeed {
  legalName: string;
  tradeName: string;
  businessType: string;
  domain: string;
  email: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  address: string;
  currency: string;
  timeZone: string;
  gstin?: string;
  registrationNumber?: string;
  financialYearStartMonth: number;
  ownerName: string;
  passwordHash: string;
  /** PENDING_VERIFICATION for self sign-up (OTP follows); ACTIVE when the product owner creates it. */
  status: "PENDING_VERIFICATION" | "ACTIVE";
  mustChangePassword?: boolean;
  products: Product[];
  plan?: string;
  maxEmployees?: number | null;
  subscriptionEndsAt?: Date | null;
  provisionedBy: "SELF" | "SUPERADMIN";
}

/**
 * Creates everything a new workspace needs inside the caller's transaction:
 * the business, its current financial year, head office branch and main
 * warehouse, the Owner role and the owner's login — plus the HR starter
 * setup when HRMS is among the products.
 */
export async function seedWorkspace(session: ClientSession, input: WorkspaceSeed): Promise<{ businessId: Types.ObjectId; userId: Types.ObjectId }> {
  const [business] = await Business.create(
    [
      {
        legalName: input.legalName,
        tradeName: input.tradeName,
        businessType: input.businessType,
        domain: input.domain,
        email: input.email,
        phone: input.phone,
        country: input.country,
        state: input.state,
        city: input.city,
        address: input.address,
        currency: input.currency,
        timeZone: input.timeZone,
        gstin: input.gstin,
        registrationNumber: input.registrationNumber,
        financialYearStartMonth: input.financialYearStartMonth,
        status: input.status,
        products: input.products,
        plan: input.plan ?? "STARTER",
        maxEmployees: input.maxEmployees ?? null,
        subscriptionEndsAt: input.subscriptionEndsAt ?? null,
        provisionedBy: input.provisionedBy,
      },
    ],
    { session }
  );
  const businessId: Types.ObjectId = business._id;

  const { startDate, endDate, label } = computeCurrentFinancialYear(input.financialYearStartMonth);
  await FinancialYear.create([{ businessId, startDate, endDate, label, status: "OPEN", isCurrent: true }], { session });

  const [branch] = await Branch.create([{ businessId, code: "MAIN", name: "Head Office", isDefault: true, isActive: true }], { session });
  const [warehouse] = await Warehouse.create(
    [{ businessId, branchId: branch._id, code: "MAIN", name: "Main Warehouse", isDefault: true, isActive: true }],
    { session }
  );

  business.defaultBranchId = branch._id;
  business.defaultWarehouseId = warehouse._id;
  await business.save({ session });

  const [ownerRole] = await Role.create(
    [
      {
        businessId,
        name: OWNER_ROLE_NAME,
        description: "Full access to all modules. Automatically assigned to the business owner.",
        permissions: [OWNER_ALL_PERMISSIONS],
        isSystemRole: true,
        isActive: true,
      },
    ],
    { session }
  );

  const active = input.status === "ACTIVE";
  const [user] = await User.create(
    [
      {
        businessId,
        name: input.ownerName,
        username: usernameFromEmail(input.email),
        email: input.email,
        phone: input.phone,
        passwordHash: input.passwordHash,
        roleId: ownerRole._id,
        branchIds: [],
        warehouseIds: [],
        status: active ? "ACTIVE" : "PENDING_VERIFICATION",
        isEmailVerified: active,
        mustChangePassword: input.mustChangePassword ?? false,
      },
    ],
    { session }
  );

  if (input.products.includes("HRMS")) await seedHrDefaults(businessId, session);

  return { businessId, userId: user._id };
}

export interface ProvisionInput {
  legalName: string;
  tradeName?: string;
  businessType?: string;
  ownerName: string;
  email: string;
  phone?: string;
  password: string;
  country: string;
  state?: string;
  city?: string;
  address?: string;
  gstin?: string;
  currency: string;
  timeZone: string;
  financialYearStartMonth: number;
  products: Product[];
  plan: string;
  maxEmployees?: number | null;
  subscriptionEndsAt?: Date | null;
}

/**
 * A workspace the product owner creates and sells: active immediately, owner
 * already verified, and the owner is asked to change the handed-over password.
 */
export async function provisionWorkspace(input: ProvisionInput): Promise<{ businessId: string; userId: string; domain: string }> {
  const tradeName = input.tradeName || input.legalName;
  const domain = await uniqueDomain(slugifyDomain(tradeName));
  const passwordHash = await hashPassword(input.password);
  const state = input.state || resolveGstState({ gstin: input.gstin })?.name || "";

  const session = await mongoose.startSession();
  const out: { ids?: { businessId: Types.ObjectId; userId: Types.ObjectId } } = {};
  try {
    await session.withTransaction(async () => {
      out.ids = await seedWorkspace(session, {
        legalName: input.legalName,
        tradeName,
        businessType: input.businessType || (input.products.includes("ERP") ? "Retail" : "Services"),
        domain,
        email: input.email,
        phone: input.phone ?? "",
        country: input.country,
        state,
        city: input.city ?? "",
        address: input.address ?? "",
        currency: input.currency,
        timeZone: input.timeZone,
        gstin: input.gstin || undefined,
        financialYearStartMonth: input.financialYearStartMonth,
        ownerName: input.ownerName,
        passwordHash,
        status: "ACTIVE",
        mustChangePassword: true,
        products: input.products,
        plan: input.plan,
        maxEmployees: input.maxEmployees ?? null,
        subscriptionEndsAt: input.subscriptionEndsAt ?? null,
        provisionedBy: "SUPERADMIN",
      });
    });
  } finally {
    await session.endSession();
  }

  const { businessId, userId } = out.ids!;
  await recordAudit({
    businessId,
    userId: null,
    action: "CREATE",
    module: "superadmin",
    documentType: "Business",
    documentId: businessId,
    newValue: { products: input.products, plan: input.plan, maxEmployees: input.maxEmployees ?? null },
    reason: "Workspace created by the product owner",
  });

  return { businessId: businessId.toString(), userId: userId.toString(), domain };
}

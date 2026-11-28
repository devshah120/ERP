import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { Employee } from "@/models/hr";
import { AppError } from "@/lib/errors/AppError";
import { normalizeProducts } from "@/lib/products";
import { currentRolePermissions } from "@/lib/auth/roleUpgrade";
import "@/models";

/**
 * Reference implementation for a protected route: resolve the auth context
 * from the access-token cookie, then use it to tenant-scope every query.
 * Every future module's routes should follow this same shape.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  // Reachable with a temporary password, so the app knows to show the change-password screen.
  const ctx = getAuthContext(req, { allowPasswordChangePending: true });

  const user = await User.findOne({ _id: ctx.userId, businessId: ctx.businessId }).lean();
  if (!user) throw AppError.notFound("User not found");

  // Read the role from the user record, not the token: HR may have changed it since sign-in.
  const [role, business, financialYear, employee] = await Promise.all([
    Role.findOne({ _id: user.roleId, businessId: ctx.businessId }).lean(),
    Business.findById(ctx.businessId).lean(),
    FinancialYear.findOne({ businessId: ctx.businessId, isCurrent: true }).lean(),
    // The employee record linked to this login, which is what self-service screens show.
    ctx.products.includes("HRMS")
      ? Employee.findOne({ businessId: ctx.businessId, userId: ctx.userId, deletedAt: null }, { _id: 1 }).lean<{ _id: unknown }>()
      : Promise.resolve(null),
  ]);

  // The access token is a snapshot from sign-in. When the role, its permissions,
  // branch/warehouse access or the workspace's products changed since, the
  // client renews its token (no sign-out needed) and loads this again.
  const permissions = await currentRolePermissions(role);
  const products = normalizeProducts(business?.products);
  const sameSet = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  const ids = (list: unknown[] | undefined) => (list ?? []).map(String);
  const stale =
    String(user.roleId) !== String(ctx.roleId) ||
    !sameSet(permissions, ctx.permissions) ||
    !sameSet(products, ctx.products) ||
    !sameSet(ids(user.branchIds), ctx.branchIds.map(String)) ||
    !sameSet(ids(user.warehouseIds), ctx.warehouseIds.map(String)) ||
    Boolean(user.mustChangePassword) !== Boolean(ctx.mustChangePassword);

  return ok({
    stale,
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    businessId: ctx.businessId.toString(),
    role: role ? { id: role._id.toString(), name: role.name } : null,
    permissions,
    products,
    employeeId: employee ? String(employee._id) : null,
    // People who report to this login's employee record; they unlock Team Leave.
    directReports: employee
      ? await Employee.countDocuments({ businessId: ctx.businessId, reportingManagerId: employee._id, _id: { $ne: employee._id }, deletedAt: null })
      : 0,
    mustChangePassword: Boolean(ctx.mustChangePassword),
    business: business
      ? {
          name: business.tradeName,
          currency: business.currency,
          // Needed client-side to work out CGST+SGST vs IGST before saving.
          state: business.state,
          gstin: business.gstin,
          // Printed on product labels ("Mfg. & Pkd. by", customer care).
          phone: business.phone,
          email: business.email,
          city: business.city,
          address: business.address,
          plan: business.plan ?? null,
          maxEmployees: business.maxEmployees ?? null,
          subscriptionEndsAt: business.subscriptionEndsAt ? new Date(business.subscriptionEndsAt).toISOString() : null,
        }
      : null,
    financialYear: financialYear
      ? {
          label: financialYear.label,
          startDate: financialYear.startDate.toISOString(),
          endDate: financialYear.endDate.toISOString(),
        }
      : null,
  });
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { User } from "@/models/User";
import { Role } from "@/models/Role";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";
import { AppError } from "@/lib/errors/AppError";
import "@/models";

/**
 * Reference implementation for a protected route: resolve the auth context
 * from the access-token cookie, then use it to tenant-scope every query.
 * Every future module's routes should follow this same shape.
 */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);

  const [user, role, business, financialYear] = await Promise.all([
    User.findOne({ _id: ctx.userId, businessId: ctx.businessId }).lean(),
    Role.findOne({ _id: ctx.roleId, businessId: ctx.businessId }).lean(),
    Business.findById(ctx.businessId).lean(),
    FinancialYear.findOne({ businessId: ctx.businessId, isCurrent: true }).lean(),
  ]);

  if (!user) throw AppError.notFound("User not found");

  return ok({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    businessId: ctx.businessId.toString(),
    role: role ? { id: role._id.toString(), name: role.name } : null,
    permissions: ctx.permissions,
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

import { Types } from "mongoose";
import { AppError } from "@/lib/errors/AppError";
import { Business } from "@/models/Business";
import { FinancialYear } from "@/models/FinancialYear";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = any;

/** Business + working financial year, which every numbered document needs. */
export async function resolveBusinessContext(businessId: Types.ObjectId) {
  const [business, financialYear] = await Promise.all([
    Business.findById(businessId).lean<AnyDoc>(),
    FinancialYear.findOne({ businessId, isCurrent: true }).lean<AnyDoc>(),
  ]);
  if (!business?.defaultBranchId) throw AppError.badRequest("Business has no default branch", "NO_BRANCH");
  if (!financialYear) throw AppError.badRequest("No open financial year", "NO_FINANCIAL_YEAR");
  if (financialYear.status === "CLOSED") {
    throw AppError.badRequest(`Financial year ${financialYear.label} is closed`, "FY_CLOSED");
  }
  return {
    business,
    branchId: business.defaultBranchId as Types.ObjectId,
    financialYear: financialYear as { _id: Types.ObjectId; label: string },
  };
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `{ $gte, $lte }` for a yyyy-mm-dd window, or undefined when neither end is set. */
export function dayRange(fromDate?: string | null, toDate?: string | null) {
  if (!fromDate && !toDate) return undefined;
  const range: Record<string, Date> = {};
  if (fromDate) range.$gte = new Date(fromDate);
  if (toDate) {
    const to = new Date(toDate);
    to.setHours(23, 59, 59, 999);
    range.$lte = to;
  }
  return range;
}

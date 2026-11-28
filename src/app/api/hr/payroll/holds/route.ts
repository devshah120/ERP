import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listHolds, blockPayroll, holdSchema } from "@/lib/hr/holds";
import { monthQuery } from "@/lib/hr/common";

/** Salary holds for a month. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const sp = req.nextUrl.searchParams;
  const { year, month } = monthQuery.parse({ year: sp.get("year"), month: sp.get("month") });
  return ok(await listHolds(ctx, year, month));
});

/** Blocks an employee's salary for a month. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.approve");
  return okOrHeld(await blockPayroll(ctx, holdSchema.parse(await req.json())), "Salary put on hold", 201);
});

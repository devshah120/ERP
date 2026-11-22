import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { variableTemplate } from "@/lib/hr/variables";
import { monthQuery } from "@/lib/hr/common";

/** Excel template for the month with every employee and current amounts. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const sp = req.nextUrl.searchParams;
  const { year, month } = monthQuery.parse({ year: sp.get("year"), month: sp.get("month") });
  const bytes = await variableTemplate(ctx, year, month);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Variable-pay-${year}-${String(month).padStart(2, "0")}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
});

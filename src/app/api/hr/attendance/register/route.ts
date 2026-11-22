import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { monthlyRegister } from "@/lib/hr/attendance";
import { monthQuery } from "@/lib/hr/common";
import { monthLabel } from "@/lib/hr/payroll";
import { buildExportResponse } from "@/lib/export/exporter";

/** Month grid of day codes per employee; ?format=xlsx|csv downloads it. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-attendance.view");
  const sp = req.nextUrl.searchParams;
  const { year, month } = monthQuery.parse({ year: sp.get("year"), month: sp.get("month") });
  const reg = await monthlyRegister(ctx, year, month, { departmentId: sp.get("departmentId") || undefined, employeeId: sp.get("employeeId") || undefined });

  const format = sp.get("format");
  if (format === "xlsx" || format === "csv") {
    const dayCols = reg.days.map((d) => ({ key: `d${d.day}`, label: String(d.day) }));
    return buildExportResponse(
      {
        title: `Attendance Register ${monthLabel(month, year)}`,
        filterNote: "P present, A absent, HD half day, L paid leave, LOP unpaid leave, H holiday, WO weekly off, OD on duty, - unmarked (counted present)",
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "department", label: "Department" },
          ...dayCols,
          { key: "lopDays", label: "LOP", type: "number" },
          { key: "payableDays", label: "Payable", type: "number" },
        ],
        rows: reg.rows.map((r) => ({
          employeeCode: r.employeeCode,
          name: r.name,
          department: r.department,
          ...Object.fromEntries(r.codes.map((c, i) => [`d${i + 1}`, c])),
          lopDays: r.summary.lopDays,
          payableDays: r.payableDays,
        })),
      },
      format
    );
  }
  return ok(reg);
});

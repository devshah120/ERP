import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { overtimeReport } from "@/lib/hr/contractLabour";
import { monthQuery } from "@/lib/hr/common";
import { monthLabel } from "@/lib/hr/payroll";
import { buildExportResponse } from "@/lib/export/exporter";

/** Days, wages and overtime per worker per contractor for a month; ?format=xlsx|csv downloads it. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-contract-attendance.view");
  const sp = req.nextUrl.searchParams;
  const { year, month } = monthQuery.parse({ year: sp.get("year"), month: sp.get("month") });
  const report = await overtimeReport(ctx, year, month, sp.get("contractorId") || undefined);

  const format = sp.get("format");
  if (format === "xlsx" || format === "csv") {
    return buildExportResponse(
      {
        title: `Contract Labour Overtime ${monthLabel(month, year)}`,
        filterNote: "Wages = day wage × payable days (a half day counts half). Overtime = hours × hourly overtime rate.",
        columns: [
          { key: "contractor", label: "Contractor" },
          { key: "workerCode", label: "Worker code" },
          { key: "name", label: "Worker" },
          { key: "presentDays", label: "Present", type: "number" },
          { key: "halfDays", label: "Half days", type: "number" },
          { key: "absentDays", label: "Absent", type: "number" },
          { key: "payableDays", label: "Payable days", type: "number" },
          { key: "dailyWage", label: "Day wage", type: "money" },
          { key: "wages", label: "Wages", type: "money" },
          { key: "overtimeDays", label: "OT days", type: "number" },
          { key: "overtimeHours", label: "OT hours", type: "number" },
          { key: "overtimeRate", label: "OT rate / hr", type: "money" },
          { key: "overtimeAmount", label: "OT amount", type: "money" },
          { key: "total", label: "Total", type: "money" },
        ],
        rows: report.rows as unknown as Record<string, unknown>[],
        totals: { overtimeHours: report.totals.overtimeHours, wages: report.totals.wages, overtimeAmount: report.totals.overtimeAmount, total: report.totals.total },
        summary: [
          { label: "Workers", value: String(report.rows.length) },
          { label: "Overtime hours", value: report.totals.overtimeHours },
          { label: "Overtime amount", value: report.totals.overtimeAmount },
        ],
      },
      format
    );
  }
  return ok(report);
});

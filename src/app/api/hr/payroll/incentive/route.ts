import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { attendanceIncentive, postIncentive, incentiveQuery } from "@/lib/hr/incentive";
import { buildExportResponse } from "@/lib/export/exporter";

const STATUS_LABELS: Record<string, string> = { PAYABLE: "Payable", BELOW_SLAB: "Below the lowest slab", LEFT: "Left before payout" };

/** ?matrixId=&year=: each employee's year of attendance and incentive; ?format=xlsx|csv downloads it. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const sp = req.nextUrl.searchParams;
  const q = incentiveQuery.parse({ matrixId: sp.get("matrixId"), year: sp.get("year"), departmentId: sp.get("departmentId") || undefined });
  const result = await attendanceIncentive(ctx, q);

  const format = sp.get("format");
  if (format === "xlsx" || format === "csv") {
    return buildExportResponse(
      {
        title: `Attendance Incentive ${result.period.label}`,
        filterNote: `${result.matrix.name}: slabs on ${result.matrix.basis === "PERCENT" ? "% of days employed" : "days present"}; one day = monthly ${result.matrix.salaryBasis.toLowerCase()} ÷ ${result.matrix.dayDivisor}. Paid in ${result.payout.label} payroll.`,
        columns: [
          { key: "employeeCode", label: "Emp. code" },
          { key: "name", label: "Name" },
          { key: "department", label: "Department" },
          { key: "daysEmployed", label: "Days employed", type: "number" },
          { key: "weeklyOffs", label: "Weekly offs", type: "number" },
          { key: "holidays", label: "Holidays", type: "number" },
          { key: "workingDays", label: "Working days", type: "number" },
          { key: "present", label: "Present", type: "number" },
          { key: "onDuty", label: "On duty", type: "number" },
          { key: "unmarked", label: "Unmarked", type: "number" },
          { key: "paidLeave", label: "Paid leave", type: "number" },
          { key: "unpaidLeave", label: "Unpaid leave", type: "number" },
          { key: "absent", label: "Absent", type: "number" },
          { key: "eligibleDays", label: "Days counted", type: "number" },
          { key: "percent", label: "% of days employed", type: "number" },
          { key: "incentiveDays", label: "Incentive days", type: "number" },
          { key: "dayRate", label: "Day's salary", type: "money" },
          { key: "amount", label: "Incentive", type: "money" },
          { key: "statusLabel", label: "Status" },
        ],
        rows: result.rows.map((r) => ({ ...r, statusLabel: STATUS_LABELS[r.status] })),
        totals: { amount: result.totals.amount },
        summary: [
          { label: "Employees", value: String(result.totals.employees) },
          { label: "Getting an incentive", value: String(result.totals.payable) },
          { label: "Total incentive", value: result.totals.amount },
        ],
      },
      format
    );
  }
  return ok(result);
});

/** Adds the incentive to the payout month's payroll as variable pay. */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const result = await postIncentive(ctx, incentiveQuery.parse(await req.json()));
  return ok(result, `Incentive added to ${result.payout} payroll for ${result.added} employee(s)`);
});

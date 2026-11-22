import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { runPayslipsForPrint } from "@/lib/hr/payroll";
import { renderPayslipsPdf, pdfFilename, pdfResponse } from "@/lib/hr/payslipPdf";

/** Every payslip of a payroll run in one PDF, one page each. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const { id } = await params;
  const run = await runPayslipsForPrint(ctx, id);
  const name = pdfFilename("Payslips", run.period);
  return pdfResponse(await renderPayslipsPdf(run.slips, name), name);
});

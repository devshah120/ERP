import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { getPayslip } from "@/lib/hr/payroll";
import { renderPayslipsPdf, pdfFilename, pdfResponse } from "@/lib/hr/payslipPdf";
import { getPayrollSettings } from "@/lib/hr/payrollSettings";

/** One payslip as a PDF file (HR). */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  const { id } = await params;
  const slip = await getPayslip(ctx, id, { self: false });
  const name = pdfFilename("Payslip", slip.employee.code, slip.period);
  return pdfResponse(await renderPayslipsPdf([slip], name, { showBankName: (await getPayrollSettings(ctx.businessId)).showBankNameOnPayslip }), name);
});

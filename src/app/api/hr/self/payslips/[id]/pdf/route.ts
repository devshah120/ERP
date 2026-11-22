import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { getPayslip } from "@/lib/hr/payroll";
import { renderPayslipsPdf, pdfFilename, pdfResponse } from "@/lib/hr/payslipPdf";

/** The signed-in employee's own approved payslip as a PDF file. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-self.view");
  const { id } = await params;
  const slip = await getPayslip(ctx, id, { self: true });
  const name = pdfFilename("Payslip", slip.period);
  return pdfResponse(await renderPayslipsPdf([slip], name), name);
});

import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { okOrHeld } from "@/lib/approvals/http";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { labourSheet, saveLabourSheet, saveLabourSheetSchema } from "@/lib/hr/contractLabour";

/** ?date=yyyy-mm-dd[&contractorId=]: contract workers on the rolls that day with their attendance. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-contract-attendance.view");
  const sp = req.nextUrl.searchParams;
  const date = sp.get("date") || new Date().toISOString().slice(0, 10);
  return ok(await labourSheet(ctx, date, sp.get("contractorId") || undefined));
});

export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-contract-attendance.edit");
  const result = await saveLabourSheet(ctx, saveLabourSheetSchema.parse(await req.json()));
  return okOrHeld(result, (r) => `Attendance saved for ${r.saved} worker(s)`);
});

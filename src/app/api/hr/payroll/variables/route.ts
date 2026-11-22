import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { variableSheet, saveVariables, sheetSchema, saveSchema } from "@/lib/hr/variables";

/** The month's variable pay grid: employees × components, filtered by department, designation, branch or name. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  return ok(await variableSheet(ctx, sheetSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Saves the grid: positive amounts are stored, blanks and zeros cleared. */
export const PUT = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  return ok(await saveVariables(ctx, saveSchema.parse(await req.json())), "Variable pay saved");
});

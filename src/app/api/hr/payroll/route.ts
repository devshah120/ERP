import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { z } from "zod";
import { listRuns, createRun, createRunSchema } from "@/lib/hr/payroll";
import { pageQuery } from "@/lib/hr/common";

const listSchema = z.object({ status: z.string().trim().max(20).optional(), year: z.coerce.number().int().optional(), ...pageQuery });

export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  return ok(await listRuns(ctx, listSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const result = await createRun(ctx, createRunSchema.parse(await req.json()));
  return created(result, `Payroll ${result.runNumber} drafted with ${result.payslips} payslip(s)`);
});

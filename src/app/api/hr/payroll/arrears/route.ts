import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { listArrears, arrearListSchema, createDayArrear, dayArrearSchema, createDaArrears, daArrearSchema } from "@/lib/hr/arrears";

/** Arrears, filtered by kind (INCREMENT / DAY / DA) and status. */
export const GET = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.view");
  return ok(await listArrears(ctx, arrearListSchema.parse(Object.fromEntries(req.nextUrl.searchParams))));
});

/** Creates a day arrear, or previews / creates DA arrears (`commit`). */
export const POST = withApiHandler(async (req: NextRequest) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-payroll.process");
  const body = await req.json();
  const { kind } = z.object({ kind: z.enum(["DAY", "DA"]) }).parse(body);
  if (kind === "DAY") return created(await createDayArrear(ctx, dayArrearSchema.parse(body)), "Day arrear added to the next payroll");
  const result = await createDaArrears(ctx, daArrearSchema.parse(body));
  return ok(result, result.committed ? "DA arrears added to the next payroll" : undefined);
});

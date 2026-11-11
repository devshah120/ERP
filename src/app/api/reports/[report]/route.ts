import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext } from "@/lib/auth/context";
import { reportQuerySchema, runReport, getReport } from "@/lib/reports/service";
import { AppError } from "@/lib/errors/AppError";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { report } = await params;
  if (!getReport(report)) throw AppError.notFound("Unknown report");

  const ctx = getAuthContext(req);
  const query = reportQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));

  return ok(await runReport(report, ctx, query));
});

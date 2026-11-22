import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import "@/models";
import { hrReport } from "@/lib/hr/insights";
import { buildExportResponse } from "@/lib/export/exporter";

/** ?year=&month= scope the report; ?format=xlsx|csv downloads it instead of returning JSON. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const ctx = getAuthContext(req);
  requirePermission(ctx, "hr-reports.view");
  const { report } = await params;
  const sp = req.nextUrl.searchParams;
  const payload = await hrReport(ctx, report, {
    year: sp.get("year") ? Number(sp.get("year")) : undefined,
    month: sp.get("month") ? Number(sp.get("month")) : undefined,
  });
  const format = sp.get("format");
  if (format === "xlsx" || format === "csv") return buildExportResponse(payload, format);
  return ok(payload);
});

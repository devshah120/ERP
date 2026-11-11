import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext } from "@/lib/auth/context";
import { reportQuerySchema, runReport, getReport } from "@/lib/reports/service";
import { buildExportResponse } from "@/lib/export/exporter";
import { describeFilters, resolveFormat, assertNotTruncated, EXPORT_PAGE_SIZE } from "@/lib/export/shared";
import "@/models";

/**
 * Exports a report using the same runner the screen uses, so the file always
 * matches what the user is looking at: same filters, same column selection,
 * same ordering.
 */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { report } = await params;
  const def = getReport(report);
  if (!def) throw AppError.notFound("Unknown report");

  const ctx = getAuthContext(req);
  const searchParams = Object.fromEntries(req.nextUrl.searchParams);
  const format = resolveFormat(searchParams.format);

  // Validate the caller's filters, then widen the page so the file holds the
  // whole filtered set rather than just the page the user is looking at.
  const validated = reportQuerySchema.parse(searchParams);
  const result = await runReport(report, ctx, {
    ...validated,
    page: 1,
    pageSize: EXPORT_PAGE_SIZE,
  });
  assertNotTruncated(result.total, result.rows.length);

  return buildExportResponse(
    {
      title: result.title,
      columns: result.columns,
      rows: result.rows,
      totals: result.totals,
      summary: result.summary,
      filterNote: describeFilters(searchParams),
    },
    format
  );
});

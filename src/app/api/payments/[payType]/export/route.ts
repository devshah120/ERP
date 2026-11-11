import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getPaymentUi } from "@/lib/payments/ui";
import { listPayments } from "@/lib/payments/service";
import { getPath } from "@/lib/resources/ui/paths";
import { buildExportResponse } from "@/lib/export/exporter";
import { describeFilters, resolveFormat, assertNotTruncated, EXPORT_PAGE_SIZE } from "@/lib/export/shared";
import "@/models";

/** Exports the receipt/payment listing with the active filters and the
 *  user's column selection, through the same query the screen uses. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { payType } = await params;
  const ui = getPaymentUi(payType);
  if (!ui) throw AppError.notFound("Unknown payment type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, ui.permissions.view);

  const searchParams = Object.fromEntries(req.nextUrl.searchParams);
  const format = resolveFormat(searchParams.format);

  const result = await listPayments(ui, req.nextUrl.searchParams, ctx, {
    pageSizeOverride: EXPORT_PAGE_SIZE,
  });
  assertNotTruncated(result.total, result.items.length);

  const requested = searchParams.columns
    ? new Set(
        searchParams.columns
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      )
    : null;
  const selected = requested ? ui.columns.filter((c) => requested.has(c.key)) : ui.columns;
  const finalColumns = selected.length > 0 ? selected : ui.columns;

  const rows = result.items.map((item) => {
    const row: Record<string, unknown> = {};
    for (const col of finalColumns) row[col.key] = getPath(item, col.key);
    return row;
  });

  return buildExportResponse(
    {
      title: ui.title,
      columns: finalColumns.map((c) => ({
        key: c.key,
        label: c.label,
        type: c.type === "party" ? "text" : c.type,
      })),
      rows,
      filterNote: describeFilters(searchParams),
      summary: [{ label: "Records", value: String(result.total) }],
    },
    format
  );
});

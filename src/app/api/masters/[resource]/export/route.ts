import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getResource } from "@/lib/resources/registry";
import { getResourceUi } from "@/lib/resources/ui/registry";
import { queryResource } from "@/lib/resources/handlers";
import { getPath } from "@/lib/resources/ui/paths";
import { buildExportResponse } from "@/lib/export/exporter";
import { describeFilters, resolveFormat, assertNotTruncated, EXPORT_PAGE_SIZE } from "@/lib/export/shared";
import "@/models";

/** Exports a master listing, honouring the active search/filters and the
 *  user's column selection. Uses the same query function as the list screen. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource } = await params;
  const def = getResource(resource);
  const ui = getResourceUi(resource);
  if (!def || !ui) throw AppError.notFound("Unknown resource");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.view);

  const searchParams = Object.fromEntries(req.nextUrl.searchParams);
  const format = resolveFormat(searchParams.format);

  const result = await queryResource(def, ctx.businessId, searchParams, {
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
      columns: finalColumns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
      rows,
      filterNote: describeFilters(searchParams),
      summary: [{ label: "Records", value: String(result.total) }],
    },
    format
  );
});

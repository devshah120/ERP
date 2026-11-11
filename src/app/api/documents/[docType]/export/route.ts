import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { getDocumentUi } from "@/lib/documents/ui";
import { listDocuments } from "@/lib/documents/list";
import { getPath } from "@/lib/resources/ui/paths";
import { buildExportResponse } from "@/lib/export/exporter";
import { describeFilters, resolveFormat, assertNotTruncated, EXPORT_PAGE_SIZE } from "@/lib/export/shared";
import "@/models";

/** Exports a document listing with the same filters and column selection
 *  the user has on screen. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType } = await params;
  const def = getDocumentDefinition(docType);
  const ui = getDocumentUi(docType);
  if (!def || !ui) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.view);

  const searchParams = Object.fromEntries(req.nextUrl.searchParams);
  const format = resolveFormat(searchParams.format);

  const result = await listDocuments(docType, searchParams, ctx, { pageSizeOverride: EXPORT_PAGE_SIZE });
  assertNotTruncated(result.total, result.items.length);

  // Honour the column selection sent by the screen; fall back to all columns.
  const requested = searchParams.columns
    ? new Set(searchParams.columns.split(",").map((s) => s.trim()).filter(Boolean))
    : null;
  const columns = requested ? ui.columns.filter((c) => requested.has(c.key)) : ui.columns;
  const finalColumns = columns.length > 0 ? columns : ui.columns;

  const rows = result.items.map((doc) => {
    const row: Record<string, unknown> = {};
    for (const col of finalColumns) row[col.key] = getPath(doc, col.key);
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

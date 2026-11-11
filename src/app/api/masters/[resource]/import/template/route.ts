import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getResource } from "@/lib/resources/registry";
import { getImportDefinition } from "@/lib/import/registry";
import { buildImportTemplate } from "@/lib/import/service";
import "@/models";

/** Downloads the sample import template for a module. */
export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource } = await params;
  const def = getImportDefinition(resource);
  const resourceDef = getResource(resource);
  if (!def) throw AppError.notFound("This module does not support import");

  const ctx = getAuthContext(req);
  // Importing creates records, so gate the template behind the same permission.
  if (resourceDef) requirePermission(ctx, resourceDef.permissions.create);

  const buffer = await buildImportTemplate(def);
  const filename = `${resource}-import-template.xlsx`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

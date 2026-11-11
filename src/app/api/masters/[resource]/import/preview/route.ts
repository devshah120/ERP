import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getResource } from "@/lib/resources/registry";
import { getImportDefinition } from "@/lib/import/registry";
import { parseImportFile, previewImport } from "@/lib/import/service";
import "@/models";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Validates an uploaded file and returns a preview. Writes nothing — the user
 * reviews row-level errors before committing.
 */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { resource } = await params;
  const def = getImportDefinition(resource);
  const resourceDef = getResource(resource);
  if (!def || !resourceDef) throw AppError.notFound("This module does not support import");

  const ctx = getAuthContext(req);
  requirePermission(ctx, resourceDef.permissions.create);

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw AppError.badRequest("Attach a file to import", "NO_FILE");
  if (file.size > MAX_UPLOAD_BYTES) {
    throw AppError.badRequest("File is larger than 5 MB", "FILE_TOO_LARGE");
  }

  const sheet = await parseImportFile(file);
  return ok(await previewImport(resource, sheet, ctx));
});

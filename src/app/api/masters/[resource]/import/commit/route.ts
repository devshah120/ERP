import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getResource } from "@/lib/resources/registry";
import { getImportDefinition } from "@/lib/import/registry";
import { parseImportFile, commitImport } from "@/lib/import/service";
import "@/models";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Imports the uploaded file. The file is re-validated here rather than
 * trusting the preview: the preview is advisory, and the data could have
 * changed (or the payload been tampered with) between the two calls.
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

  const skipDuplicates = String(form.get("skipDuplicates") ?? "") === "true";

  const sheet = await parseImportFile(file);
  const result = await commitImport(resource, sheet, ctx, { skipDuplicates });

  return ok(
    result,
    `Imported ${result.imported} record(s)` +
      (result.skippedDuplicates > 0 ? `, skipped ${result.skippedDuplicates} duplicate(s)` : "")
  );
});

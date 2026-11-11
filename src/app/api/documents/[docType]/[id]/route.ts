import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { getDocument, updateDocument, deleteDraftDocument } from "@/lib/documents/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType, id } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.view);

  return ok(await getDocument(docType, id, ctx));
});

export const PATCH = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType, id } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.edit);

  const body = await req.json();
  const input = def.updateSchema.parse(body);
  const doc = await updateDocument(docType, id, input, ctx);

  return ok(doc, `${def.label} updated successfully`);
});

/**
 * Deletes a draft. Anything past DRAFT has a number that has been issued, may
 * have moved stock and may be linked to other documents, so it is cancelled
 * through the workflow instead of erased — see deleteDraftDocument.
 */
export const DELETE = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType, id } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.edit);

  await deleteDraftDocument(docType, id, ctx);
  return ok({ id }, `${def.label} deleted`);
});

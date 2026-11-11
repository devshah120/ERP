import { NextRequest } from "next/server";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { ok, created } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { listDocuments } from "@/lib/documents/list";
import { createDocument } from "@/lib/documents/service";
import "@/models";

export const GET = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.view);

  const result = await listDocuments(docType, Object.fromEntries(req.nextUrl.searchParams), ctx);
  return ok(result);
});

export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType } = await params;
  const def = getDocumentDefinition(docType);
  if (!def) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);
  requirePermission(ctx, def.permissions.create);

  const body = await req.json();
  const input = def.createSchema.parse(body);
  const doc = await createDocument(docType, input, ctx);

  return created(doc, `${def.label} created successfully`);
});

import { NextRequest } from "next/server";
import { z } from "zod";
import { withApiHandler } from "@/lib/http/withApiHandler";
import { created } from "@/lib/http/response";
import { AppError } from "@/lib/errors/AppError";
import { getAuthContext, requirePermission } from "@/lib/auth/context";
import { getDocumentDefinition } from "@/lib/documents/registry";
import { convertDocument } from "@/lib/documents/transitions";
import "@/models";

const convertSchema = z.object({
  toType: z.string().trim().min(1),
  /** Target-specific extras, e.g. warehouseId for a delivery challan. */
  extra: z.record(z.string(), z.unknown()).default({}),
});

/** Quotation → Order → Delivery → Invoice → Return → Credit Note. */
export const POST = withApiHandler(async (req: NextRequest, { params }) => {
  const { docType, id } = await params;
  const fromDef = getDocumentDefinition(docType);
  if (!fromDef) throw AppError.notFound("Unknown document type");

  const ctx = getAuthContext(req);

  const { toType, extra } = convertSchema.parse(await req.json());
  const toDef = getDocumentDefinition(toType);
  if (!toDef) throw AppError.notFound("Unknown target document type");

  requirePermission(ctx, toDef.permissions.create);

  const doc = await convertDocument(docType, id, toType, extra, ctx);

  return created(doc, `${toDef.label} created from ${fromDef.label}`);
});
